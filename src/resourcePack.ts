/* eslint-disable no-await-in-loop */
import { join, dirname, basename } from 'path'
import fs from 'fs'
import JSZip from 'jszip'
import { proxy, subscribe } from 'valtio'
import { WorldRendererThree } from 'renderer/viewer/lib/worldrendererThree'
import { armorTextures } from 'renderer/viewer/lib/entity/armorModels'
import { collectFilesToCopy, copyFilesAsyncWithProgress, mkdirRecursive, removeFileRecursiveAsync } from './browserfs'
import { setLoadingScreenStatus } from './appStatus'
import { showNotification } from './react/NotificationProvider'
import { options } from './optionsStorage'
import { showOptionsModal } from './react/SelectOption'
import { appStatusState } from './react/AppStatusProvider'
import { appReplacableResources, resourcesContentOriginal } from './generated/resources'
import { gameAdditionalState, miscUiState } from './globalState'
import { watchUnloadForCleanup } from './gameUnload'

export const resourcePackState = proxy({
  resourcePackInstalled: false,
  isServerDownloading: false,
  isServerInstalling: false
})

const getLoadedImage = async (url: string) => {
  const img = new Image()
  img.src = url
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })
  return img
}

const texturePackBasePath = '/data/resourcePacks/'
export const uninstallResourcePack = async (name = 'default') => {
  if (await existsAsync('/resourcepack/pack.mcmeta')) {
    await removeFileRecursiveAsync('/resourcepack')
    gameAdditionalState.usingServerResourcePack = false
  }
  const basePath = texturePackBasePath + name
  if (!(await existsAsync(basePath))) return
  await removeFileRecursiveAsync(basePath)
  options.enabledResourcepack = null
  await updateTexturePackInstalledState()
}

export const getResourcePackNames = async () => {
  // TODO
  try {
    return { [await fs.promises.readFile(join(texturePackBasePath, 'default', 'name.txt'), 'utf8')]: true }
  } catch (err) {
    return {}
  }
}

export const fromTexturePackPath = (path) => {
  // return join(texturePackBasePath, path)
}

export const updateTexturePackInstalledState = async () => {
  try {
    resourcePackState.resourcePackInstalled = await existsAsync(texturePackBasePath + 'default')
  } catch {
  }
}

export const installTexturePackFromHandle = async () => {
  // await mkdirRecursive(texturePackBasePath)
  // await copyFilesAsyncWithProgress('/world', texturePackBasePath)
  // await completeTexturePackInstall()
}

export const installResourcepackPack = async (file: File | ArrayBuffer, displayName = file['name'], name = 'default', isServer = false) => {
  console.time('processResourcePack')
  const installPath = isServer ? '/resourcepack/' : texturePackBasePath + name
  try {
    await uninstallResourcePack(name)
  } catch (err) {
  }
  const showLoader = !isServer
  const status = 'Installing resource pack: copying all files'

  if (showLoader) {
    setLoadingScreenStatus(status)
  }
  // extract the zip and write to fs every file in it
  const zip = new JSZip()
  const zipFile = await zip.loadAsync(file)
  if (!zipFile.file('pack.mcmeta')) throw new Error('Not a resource pack: missing /pack.mcmeta')
  await mkdirRecursive(installPath)

  const allFilesArr = Object.entries(zipFile.files)
    .filter(([path]) => !path.startsWith('.') && !path.startsWith('_') && !path.startsWith('/')) // ignore dot files and __MACOSX
  let done = 0
  const upStatus = () => {
    if (showLoader) {
      setLoadingScreenStatus(`${status} ${Math.round(done / allFilesArr.length * 100)}%`)
    }
  }
  const createdDirs = new Set<string>()
  const copyTasks = [] as Array<Promise<void>>
  console.time('resourcePackCopy')
  await Promise.all(allFilesArr.map(async ([path, file]) => {
    const writePath = join(installPath, path)
    if (path.endsWith('/')) return
    const dir = dirname(writePath)
    if (!createdDirs.has(dir)) {
      await mkdirRecursive(dir)
      createdDirs.add(dir)
    }
    if (copyTasks.length > 100) {
      await Promise.all(copyTasks)
      copyTasks.length = 0
    }
    const promise = fs.promises.writeFile(writePath, Buffer.from(await file.async('arraybuffer')) as any)
    copyTasks.push(promise)
    await promise
    done++
    upStatus()
  }))
  console.timeEnd('resourcePackCopy')
  await completeTexturePackInstall(displayName, name, isServer)
  console.log('resource pack install done')
  console.timeEnd('processResourcePack')
}

// or enablement
export const completeTexturePackInstall = async (displayName: string | undefined, name: string, isServer: boolean) => {
  const basePath = isServer ? '/resourcepack/' : texturePackBasePath + name
  if (displayName) {
    await fs.promises.writeFile(join(basePath, 'name.txt'), displayName, 'utf8')
  }

  await updateTextures()
  setLoadingScreenStatus(undefined)
  showNotification('Texturepack installed & enabled')
  await updateTexturePackInstalledState()
  if (isServer) {
    gameAdditionalState.usingServerResourcePack = true
  } else {
    options.enabledResourcepack = name
  }
}

const existsAsync = async (path) => {
  try {
    await fs.promises.stat(path)
    return true
  } catch (err) {
    return false
  }
}

const arrEqual = (a: any[], b: any[]) => a.length === b.length && a.every((x) => b.includes(x))

const getSizeFromImage = async (filePath: string) => {
  const probeImg = new Image()
  const file = await fs.promises.readFile(filePath, 'base64')
  probeImg.src = `data:image/png;base64,${file}`
  await new Promise((resolve, reject) => {
    probeImg.addEventListener('load', resolve)
  })
  if (probeImg.width !== probeImg.height) throw new Error(`Probe texture ${filePath} is not square`)
  return probeImg.width
}

export const getActiveResourcepackBasePath = async () => {
  if (await existsAsync('/resourcepack/pack.mcmeta')) {
    return '/resourcepack'
  }
  const { enabledResourcepack } = options
  // const enabledResourcepack = 'default'
  if (!enabledResourcepack) {
    return null
  }
  if (await existsAsync(`/data/resourcePacks/${enabledResourcepack}/pack.mcmeta`)) {
    return `/data/resourcePacks/${enabledResourcepack}`
  }
  return null
}

const isDirSafe = async (filePath: string) => {
  try {
    return await fs.promises.stat(filePath).then(stat => stat.isDirectory()).catch(() => false)
  } catch (err) {
    return false
  }
}

const getFilesMapFromDir = async (dir: string) => {
  const files = [] as string[]
  const scan = async (dir) => {
    const dirFiles = await fs.promises.readdir(dir)
    for (const file of dirFiles) {
      const filePath = join(dir, file)
      if (await isDirSafe(filePath)) {
        await scan(filePath)
      } else {
        files.push(filePath)
      }
    }
  }
  await scan(dir)
  return files
}

export const getResourcepackTiles = async (type: 'blocks' | 'items' | 'armor', existingTextures: string[]) => {
  const basePath = await getActiveResourcepackBasePath()
  if (!basePath) return
  let firstTextureSize: number | undefined
  const namespaces = await fs.promises.readdir(join(basePath, 'assets'))
  if (appStatusState.status) {
    setLoadingScreenStatus(`Generating atlas texture for ${type}`)
  }
  const textures = {} as Record<string, HTMLImageElement>
  let path
  switch (type) {
    case 'blocks':
      path = 'block'
      break
    case 'items':
      path = 'item'
      break
    case 'armor':
      path = 'models/armor'
      break
    default:
      throw new Error('Invalid type')
  }
  for (const namespace of namespaces) {
    const texturesCommonBasePath = `${basePath}/assets/${namespace}/textures`
    const isMinecraftNamespace = namespace === 'minecraft'
    let texturesBasePath = `${texturesCommonBasePath}/${path}`
    const texturesBasePathAlt = `${texturesCommonBasePath}/${path}s`
    if (!(await existsAsync(texturesBasePath))) {
      if (await existsAsync(texturesBasePathAlt)) {
        texturesBasePath = texturesBasePathAlt
      }
    }
    const allInterestedPaths = new Set(
      existingTextures
        .filter(tex => (isMinecraftNamespace && !tex.includes(':')) || (tex.includes(':') && tex.split(':')[0] === namespace))
        .map(tex => {
          tex = tex.split(':')[1] ?? tex
          if (tex.includes('/')) {
            return join(`${texturesCommonBasePath}/${tex}`)
          }
          return join(texturesBasePath, tex)
        })
    )
    // add all files from texturesCommonBasePath
    // if (!isMinecraftNamespace) {
    //   const commonBasePathFiles = await getFilesMapFromDir(texturesCommonBasePath)
    //   for (const file of commonBasePathFiles) {
    //     allInterestedPaths.add(file)
    //   }
    // }
    const allInterestedPathsPerDir = new Map<string, string[]>()
    for (const path of allInterestedPaths) {
      const dir = dirname(path)
      if (!allInterestedPathsPerDir.has(dir)) {
        allInterestedPathsPerDir.set(dir, [])
      }
      const file = basename(path)
      allInterestedPathsPerDir.get(dir)!.push(file)
    }
    // filter out by readdir each dir
    const allInterestedImages = [] as string[]
    for (const [dir, paths] of allInterestedPathsPerDir) {
      if (!await existsAsync(dir)) {
        continue
      }
      const dirImages = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.png')).map(f => f.replace('.png', ''))
      allInterestedImages.push(...dirImages.filter(image => paths.includes(image)).map(image => `${dir}/${image}`))
    }

    if (allInterestedImages.length === 0) {
      continue
    }

    const firstImageFile = allInterestedImages[0]!
    try {
      // todo check all sizes from atlas
      firstTextureSize ??= await getSizeFromImage(`${firstImageFile}.png`)
    } catch (err) { }
    const newTextures = Object.fromEntries(await Promise.all(allInterestedImages.map(async (image) => {
      const imagePath = `${image}.png`
      const contents = await fs.promises.readFile(imagePath, 'base64')
      const img = await getLoadedImage(`data:image/png;base64,${contents}`)
      const imageRelative = image.replace(`${texturesBasePath}/`, '').replace(`${texturesCommonBasePath}/`, '')
      const textureName = isMinecraftNamespace ? imageRelative : `${namespace}:${imageRelative}`
      return [textureName, img]
    })))
    Object.assign(textures, newTextures) as any
  }
  return {
    firstTextureSize,
    textures
  }
}

const prepareBlockstatesAndModels = async () => {
  viewer.world.customBlockStates = {}
  viewer.world.customModels = {}
  const usedTextures = new Set<string>()
  const basePath = await getActiveResourcepackBasePath()
  if (!basePath) return
  if (appStatusState.status) {
    setLoadingScreenStatus('Reading resource pack blockstates and models')
  }

  const readModelData = async (path: string, type: 'models' | 'blockstates', namespaceDir: string) => {
    if (!(await existsAsync(path))) return
    const files = await fs.promises.readdir(path)
    const jsons = {} as Record<string, any>
    await Promise.all(files.map(async (file) => {
      const filePath = `${path}/${file}`
      if (file.endsWith('.json')) {
        const contents = await fs.promises.readFile(filePath, 'utf8')
        let name = file.replace('.json', '')
        if (type === 'models') {
          name = `${path.endsWith('block') ? 'block' : 'item'}/${name}`
        }
        const parsed = JSON.parse(contents)
        if (namespaceDir === 'minecraft') {
          jsons[name] = parsed
        }
        jsons[`${namespaceDir}:${name}`] = parsed
        if (type === 'models') {
          for (let texturePath of Object.values(parsed.textures ?? {})) {
            if (typeof texturePath !== 'string') continue
            if (texturePath.startsWith('#')) continue
            if (!texturePath.includes(':')) texturePath = `minecraft:${texturePath}`
            usedTextures.add(texturePath as string)
          }
        }
      }
    }))
    return jsons
  }

  const readData = async (namespaceDir: string) => {
    const blockstatesPath = `${basePath}/assets/${namespaceDir}/blockstates`
    const blockModelsPath = `${basePath}/assets/${namespaceDir}/models/block`
    const itemModelsPath = `${basePath}/assets/${namespaceDir}/models/item`

    Object.assign(viewer.world.customBlockStates!, await readModelData(blockstatesPath, 'blockstates', namespaceDir))
    Object.assign(viewer.world.customModels!, await readModelData(blockModelsPath, 'models', namespaceDir))
    Object.assign(viewer.world.customModels!, await readModelData(itemModelsPath, 'models', namespaceDir))
  }

  try {
    const assetsDirs = await fs.promises.readdir(join(basePath, 'assets'))
    for (const assetsDir of assetsDirs) {
      await readData(assetsDir)
    }
  } catch (err) {
    console.error('Failed to read some of resource pack blockstates and models', err)
    viewer.world.customBlockStates = undefined
    viewer.world.customModels = undefined
  }
  return { usedTextures }
}

const downloadAndUseResourcePack = async (url: string): Promise<void> => {
  try {
    resourcePackState.isServerInstalling = true
    resourcePackState.isServerDownloading = true
    console.log('Downloading server resource pack', url)
    console.time('downloadServerResourcePack')
    const response = await fetch(url).catch((err) => {
      console.log(`Ensure server on ${url} support CORS which is not required for regular client, but is required for the web client`)
      console.error(err)
      showNotification('Failed to download resource pack: ' + err.message)
    })
    console.timeEnd('downloadServerResourcePack')
    if (!response) return
    resourcePackState.isServerDownloading = false
    const resourcePackData = await response.arrayBuffer()
    showNotification('Installing resource pack...')
    await installResourcepackPack(resourcePackData, undefined, undefined, true).catch((err) => {
      console.error(err)
      showNotification('Failed to install resource pack: ' + err.message)
    })
  } finally {
    resourcePackState.isServerInstalling = false
    resourcePackState.isServerDownloading = false
  }
}

const waitForGameEvent = async () => {
  if (miscUiState.gameLoaded) return
  await new Promise<void>(resolve => {
    const listener = () => resolve()
    customEvents.once('gameLoaded', listener)
    watchUnloadForCleanup(() => {
      customEvents.removeListener('gameLoaded', listener)
    })
  })
}

export const onAppLoad = () => {
  customEvents.on('mineflayerBotCreated', () => {
    // todo also handle resourcePack
    const handleResourcePackRequest = async (packet) => {
      console.log('Received resource pack request', packet)
      if (options.serverResourcePacks === 'never') return
      const promptMessagePacket = ('promptMessage' in packet && packet.promptMessage) ? packet.promptMessage : undefined
      const promptMessageText = promptMessagePacket ? '' : 'Do you want to use server resource pack?'
      // TODO!
      const hash = 'hash' in packet ? packet.hash : '-'
      const forced = 'forced' in packet ? packet.forced : false
      const choice = options.serverResourcePacks === 'always'
        ? true
        : await showOptionsModal(promptMessageText, ['Download & Install (recommended)', 'Pretend Installed (not recommended)'], {
          cancel: !forced,
          minecraftJsonMessage: promptMessagePacket,
        })
      if (!choice) {
        bot.denyResourcePack()
        return
      }
      await new Promise(resolve => {
        setTimeout(resolve, 500)
      })
      console.log('accepting resource pack')
      bot.acceptResourcePack()
      if (choice === true || choice === 'Download & Install (recommended)') {
        await downloadAndUseResourcePack(packet.url).catch((err) => {
          console.error(err)
          showNotification('Failed to download resource pack: ' + err.message)
        })
      }
    }
    bot._client.on('resource_pack_send', handleResourcePackRequest)
    bot._client.on('add_resource_pack' as any, handleResourcePackRequest)
  })

  subscribe(resourcePackState, () => {
    if (!resourcePackState.resourcePackInstalled) return
    void updateAllReplacableTextures()
  })
}

const updateAllReplacableTextures = async () => {
  const basePath = await getActiveResourcepackBasePath()
  const setCustomCss = async (path: string | null, varName: string, repeat = 1) => {
    if (path && await existsAsync(path)) {
      const contents = await fs.promises.readFile(path, 'base64')
      const dataUrl = `data:image/png;base64,${contents}`
      document.body.style.setProperty(varName, repeatArr(`url(${dataUrl})`, repeat).join(', '))
    } else {
      document.body.style.setProperty(varName, '')
    }
  }
  const setCustomPicture = async (key: string, path: string) => {
    let contents = resourcesContentOriginal[key]
    if (await existsAsync(path)) {
      const file = await fs.promises.readFile(path, 'base64')
      const dataUrl = `data:image/png;base64,${file}`
      contents = dataUrl
    }
    appReplacableResources[key].content = contents
  }
  const vars = Object.entries(appReplacableResources).filter(([, x]) => x.cssVar)
  for (const [key, { cssVar, cssVarRepeat, resourcePackPath }] of vars) {
    const resPath = `${basePath}/assets/${resourcePackPath}`
    if (cssVar) {

      await setCustomCss(resPath, cssVar, cssVarRepeat ?? 1)
    } else {

      await setCustomPicture(key, resPath)
    }
  }
}

const repeatArr = (arr, i) => Array.from({ length: i }, () => arr)

const updateTextures = async () => {
  const origBlocksFiles = Object.keys(viewer.world.sourceData.blocksAtlases.latest.textures)
  const origItemsFiles = Object.keys(viewer.world.sourceData.itemsAtlases.latest.textures)
  const origArmorFiles = Object.keys(armorTextures)
  const { usedTextures: extraBlockTextures = new Set<string>() } = await prepareBlockstatesAndModels() ?? {}
  const blocksData = await getResourcepackTiles('blocks', [...origBlocksFiles, ...extraBlockTextures])
  const itemsData = await getResourcepackTiles('items', origItemsFiles)
  const armorData = await getResourcepackTiles('armor', origArmorFiles)
  await updateAllReplacableTextures()
  viewer.world.customTextures = {}
  if (blocksData) {
    viewer.world.customTextures.blocks = {
      tileSize: blocksData.firstTextureSize,
      textures: blocksData.textures
    }
  }
  if (itemsData) {
    viewer.world.customTextures.items = {
      tileSize: itemsData.firstTextureSize,
      textures: itemsData.textures
    }
  }
  if (armorData) {
    viewer.world.customTextures.armor = {
      tileSize: armorData.firstTextureSize,
      textures: armorData.textures
    }
  }
  if (viewer.world.active) {
    await viewer.world.updateTexturesData()
    if (viewer.world instanceof WorldRendererThree) {
      viewer.world.rerenderAllChunks?.()
    }
  }
}

export const resourcepackReload = async (version) => {
  await updateTextures()
}

export const copyServerResourcePackToRegular = async (name = 'default') => {
  // Check if server resource pack exists
  if (!(await existsAsync('/resourcepack/pack.mcmeta'))) {
    throw new Error('No server resource pack is currently installed')
  }

  // Get display name from server resource pack if available
  let displayName
  try {
    displayName = await fs.promises.readFile('/resourcepack/name.txt', 'utf8')
  } catch {
    displayName = 'Server Resource Pack'
  }

  // Copy all files from server resource pack to regular location
  const destPath = texturePackBasePath + name
  await mkdirRecursive(destPath)

  setLoadingScreenStatus('Copying server resource pack to regular location')
  await copyFilesAsyncWithProgress('/resourcepack', destPath, true, ' (server -> regular)')

  // Complete the installation
  await completeTexturePackInstall(displayName, name, false)
  showNotification('Server resource pack copied to regular location')
}
