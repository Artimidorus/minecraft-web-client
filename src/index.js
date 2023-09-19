//@ts-check
/* global THREE */
require('./chat')

// workaround for mineflayer
process.versions.node = '14.0.0'

require('./menus/components/button')
require('./menus/components/edit_box')
require('./menus/components/slider')
require('./menus/components/hotbar')
require('./menus/components/health_bar')
require('./menus/components/food_bar')
require('./menus/components/breath_bar')
require('./menus/components/debug_overlay')
require('./menus/components/playerlist_overlay')
require('./menus/components/bossbars_overlay')
require('./menus/hud')
require('./menus/play_screen')
require('./menus/pause_screen')
require('./menus/loading_or_error_screen')
require('./menus/keybinds_screen')
require('./menus/options_screen')
require('./menus/advanced_options_screen')
require('./menus/notification')
require('./menus/title_screen')
require('./optionsStorage')
require('./reactUi.jsx')
require('./botControls')

// @ts-ignore
require('crypto').createPublicKey = () => { }

const { promisify } = require('util')
const browserfs = require('browserfs')
browserfs.install(window)
browserfs.configure({
  // todo change to localstorage: mkdir doesnt work for some reason
  fs: 'MountableFileSystem',
  options: {
    "/world": { fs: "LocalStorage" }
  },
}, (e) => {
  if (e) throw e
})
const _fs = require('fs')
//@ts-ignore
_fs.promises = new Proxy(Object.fromEntries(['readFile', 'writeFile', 'stat'].map(key => [key, promisify(_fs[key])])), {
  get (target, p, receiver) {
    //@ts-ignore
    if (!target[p]) throw new Error(`Not implemented fs.promises.${p}`)
    return Reflect.get(target, p, receiver)
  }
})
//@ts-ignore
_fs.promises.open = async (...args) => {
  const fd = await promisify(_fs.open)(...args)
  return Object.fromEntries(['read', 'write', 'close'].map(x => [x, async (...args) => {
    return await new Promise(resolve => {
      _fs[x](fd, ...args, (err, bytesRead, buffer) => {
        if (err) throw err
        resolve({ buffer, bytesRead })
      })
    })
  }]))
}

const net = require('net')
const Stats = require('stats.js')

const mineflayer = require('mineflayer')
const { WorldView, Viewer, MapControls } = require('prismarine-viewer/viewer')
const PrismarineWorld = require('prismarine-world')
const nbt = require('prismarine-nbt')
const pathfinder = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const Cursor = require('./cursor')
//@ts-ignore
global.THREE = require('three')
const { initVR } = require('./vr')
const { activeModalStack, showModal, hideModal, hideCurrentModal, activeModalStacks, replaceActiveModalStack, isGameActive, miscUiState, gameAdditionalState } = require('./globalState')
const { pointerLock, goFullscreen, toNumber } = require('./utils')
const { notification } = require('./menus/notification')
const { removePanorama, addPanoramaCubeMap, initPanoramaOptions } = require('./panorama')
const { createClient } = require('minecraft-protocol')
const { startLocalServer } = require('./createLocalServer')
const serverOptions = require('./defaultLocalServerOptions')
const { customCommunication } = require('./customServer')
const { default: updateTime } = require('./updateTime')
const { options } = require('./optionsStorage')
const { subscribe } = require('valtio')
const { subscribeKey } = require('valtio/utils')

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(registration => {
      console.log('SW registered: ', registration)
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError)
    })
  })
}

// ACTUAL CODE

let stats
let stats2
stats = new Stats()
stats2 = new Stats()
stats2.showPanel(2)

document.body.appendChild(stats.dom)
stats2.dom.style.left = '80px'
document.body.appendChild(stats2.dom)

window.hideStats = () => {
  stats.dom.style.display = 'none'
  stats2.dom.style.display = 'none'
}
if (localStorage.hideStats) window.hideStats()

// const debugPitch = document.createElement('span')
// debugPitch.style.cssText = `
//   position: absolute;
//   top: 0;
//   right: 0;
//   z-index: 100;
//   color:white;
// `
// document.body.appendChild(debugPitch)

const maxPitch = 0.5 * Math.PI
const minPitch = -0.5 * Math.PI

// Create three.js context, add to page
const renderer = new THREE.WebGLRenderer()
renderer.setPixelRatio(window.devicePixelRatio || 1)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

// Create viewer
const viewer = new Viewer(renderer)
initPanoramaOptions(viewer)

const frameLimit = toNumber(localStorage.frameLimit)
let interval = frameLimit && 1000 / frameLimit
window.addEventListener('option-change', (/** @type {any} */{ detail }) => {
  if (detail.name === 'frameLimit') interval = toNumber(detail.value) && 1000 / toNumber(detail.value)
})

let nextFrameFn = []
let postRenderFrameFn = () => { }
let delta = 0
let lastTime = performance.now()
const renderFrame = (/** @type {DOMHighResTimeStamp} */ time) => {
  if (window.stopLoop) return
  window.requestAnimationFrame(renderFrame)
  if (window.stopRender) return
  if (interval) {
    delta += time - lastTime
    lastTime = time
    if (delta > interval) {
      delta = delta % interval
      // continue rendering
    } else {
      return
    }
  }
  stats?.begin()
  stats2?.begin()
  viewer.update()
  renderer.render(viewer.scene, viewer.camera)
  postRenderFrameFn()
  if (nextFrameFn.length) {
    for (const fn of nextFrameFn) {
      fn()
    }
    nextFrameFn = []
  }
  stats?.end()
  stats2?.end()
}
renderFrame(performance.now())

window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight
  viewer.camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const loadingScreen = document.getElementById('loading-error-screen')

const hud = document.getElementById('hud')
const optionsScrn = document.getElementById('options-screen')
const pauseMenu = document.getElementById('pause-screen')

function setLoadingScreenStatus (status, isError = false) {
  showModal(loadingScreen)
  if (loadingScreen.hasError) return
  loadingScreen.hasError = isError
  loadingScreen.status = status
}

let mouseMovePostHandle = (e) => { }
let lastMouseCall
function onMouseMove (e) {
  if (e.type !== 'touchmove' && !pointerLock.hasPointerLock) return
  e.stopPropagation?.()
  const now = performance.now()
  // todo: limit camera movement for now to avoid unexpected jumps
  if (now - lastMouseCall < 4) return
  lastMouseCall = now
  let { mouseSensX, mouseSensY } = optionsScrn
  if (mouseSensY === true) mouseSensY = mouseSensX
  // debugPitch.innerText = +debugPitch.innerText + e.movementX
  mouseMovePostHandle({
    x: e.movementX * mouseSensX * 0.0001,
    y: e.movementY * mouseSensY * 0.0001
  })
}
window.addEventListener('mousemove', onMouseMove, { capture: true })


function hideCurrentScreens () {
  activeModalStacks['main-menu'] = activeModalStack
  replaceActiveModalStack('', [])
}

async function main () {
  const menu = document.getElementById('play-screen')
  menu.addEventListener('connect', e => {
    const options = e.detail
    connect(options)
  })
  const connectSingleplayer = () => {
    // todo clean
    connect({ server: '', port: '', proxy: '', singleplayer: true, username: 'wanderer', password: '' })
  }
  document.querySelector('#title-screen').addEventListener('singleplayer', (e) => {
    connectSingleplayer()
  })
  const qs = new URLSearchParams(window.location.search)
  if (qs.get('singleplayer') === '1') {
    // todo
    setTimeout(() => {
      connectSingleplayer()
    })
  }
}

let listeners = []
let disposables = []
let timeouts = []
let intervals = []
// only for dom listeners (no removeAllListeners)
// todo refactor them out of connect fn instead
/** @type {import('./utilsTs').RegisterListener} */
const registerListener = (target, event, callback) => {
  target.addEventListener(event, callback)
  listeners.push({ target, event, callback })
}
const removeAllListeners = () => {
  listeners.forEach(({ target, event, callback }) => {
    target.removeEventListener(event, callback)
  })
  listeners = []
  for (const disposable of disposables) {
    disposable()
  }
  disposables = []
}

/**
 * @param {{ server: any; port?: string; singleplayer: any; username: any; password: any; proxy: any; botVersion?: any; }} connectOptions
 */
async function connect (connectOptions) {
  const menu = document.getElementById('play-screen')
  menu.style = 'display: none;'
  removePanorama()

  const singeplayer = connectOptions.singleplayer
  miscUiState.singleplayer = singeplayer
  const oldSetInterval = window.setInterval
  // @ts-ignore
  window.setInterval = (callback, ms) => {
    const id = oldSetInterval.call(window, callback, ms)
    timeouts.push(id)
    return id
  }
  const oldSetTimeout = window.setTimeout
  //@ts-ignore
  window.setTimeout = (callback, ms) => {
    const id = oldSetTimeout.call(window, callback, ms)
    timeouts.push(id)
    return id
  }
  const debugMenu = hud.shadowRoot.querySelector('#debug-overlay')

  const { renderDistance, maxMultiplayerRenderDistance } = options
  const hostprompt = connectOptions.server
  const proxyprompt = connectOptions.proxy
  const username = connectOptions.username
  const password = connectOptions.password

  let host, port, proxy, proxyport
  if (!hostprompt.includes(':')) {
    host = hostprompt
    port = 25565
  } else {
    [host, port] = hostprompt.split(':')
    port = parseInt(port, 10)
  }

  if (!proxyprompt.includes(':')) {
    proxy = proxyprompt
    proxyport = undefined
  } else {
    [proxy, proxyport] = proxyprompt.split(':')
    proxyport = parseInt(proxyport, 10)
  }
  console.log(`connecting to ${host} ${port} with ${username}`)

  if (proxy) {
    console.log(`using proxy ${proxy} ${proxyport}`)
    //@ts-ignore
    net.setProxy({ hostname: proxy, port: proxyport })
  }

  setLoadingScreenStatus('Logging in')

  /** @type {mineflayer.Bot} */
  let bot
  const destroy = () => {
    // simple variant, still buggy
    postRenderFrameFn = () => { }
    if (bot) {
      bot.removeAllListeners()
      bot._client.removeAllListeners()
      bot._client = undefined
      bot = undefined
    }
    removeAllListeners()
    for (const timeout of timeouts) {
      clearTimeout(timeout)
    }
    timeouts = []
    for (const interval of intervals) {
      clearInterval(interval)
    }
    intervals = []
  }
  const handleError = (err) => {
    console.log('Encountered error!', err)

    // #region rejoin key
    const controller = new AbortController()
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyR') return
      controller.abort()
      connect(connectOptions)
      loadingScreen.hasError = false
    }, { signal: controller.signal })
    // #endregion

    setLoadingScreenStatus(`Error encountered. Error message: ${err}`, true)
    destroy()
  }

  const errorAbortController = new AbortController()
  window.addEventListener('unhandledrejection', (e) => {
    handleError(e.reason)
  }, {
    signal: errorAbortController.signal
  })
  let singlePlayerServer
  try {
    if (singeplayer) {
      window.serverDataChannel ??= {}
      window.worldLoaded = false
      //@ts-ignore TODO
      Object.assign(serverOptions, _.defaultsDeep(JSON.parse(localStorage.localServerOptions || '{}'), serverOptions))
      singlePlayerServer = startLocalServer()
      // todo need just to call quit if started
      loadingScreen.maybeRecoverable = false
      // init world, todo: do it for any async plugins
      if (!singlePlayerServer.worldsReady) {
        await new Promise(resolve => {
          singlePlayerServer.once('worldsReady', resolve)
        })
      }
    }

    bot = mineflayer.createBot({
      host,
      port,
      version: connectOptions.botVersion === '' ? false : connectOptions.botVersion,
      ...singeplayer ? {
        version: serverOptions.version,
        connect () { },
        keepAlive: false,
        customCommunication
      } : {},
      username,
      password,
      viewDistance: 'tiny',
      checkTimeoutInterval: 240 * 1000,
      noPongTimeout: 240 * 1000,
      closeTimeout: 240 * 1000
    })
    if (singeplayer) {
      bot.emit('inject_allowed')
      bot._client.emit('connect')
    }
  } catch (err) {
    handleError(err)
  }
  if (!bot) return
  hud.preload(bot)

  // bot.on('inject_allowed', () => {
  //   loadingScreen.maybeRecoverable = false
  // })

  bot.on('error', handleError)

  bot.on('kicked', (kickReason) => {
    console.log('User was kicked!', kickReason)
    setLoadingScreenStatus(`The Minecraft server kicked you. Kick reason: ${kickReason}`, true)
    destroy()
  })

  bot.on('end', (endReason) => {
    console.log('disconnected for', endReason)
    destroy()
    setLoadingScreenStatus(`You have been disconnected from the server. End reason: ${endReason}`, true)
  })

  bot.once('login', () => {
    // server is ok, add it to the history
    /** @type {string[]} */
    const serverHistory = JSON.parse(localStorage.getItem('serverHistory') || '[]')
    serverHistory.unshift(connectOptions.server)
    localStorage.setItem('serverHistory', JSON.stringify([...new Set(serverHistory)]))

    setLoadingScreenStatus('Loading world')
  })

  bot.once('spawn', () => {
    // todo display notification if not critical
    const mcData = require('minecraft-data')(bot.version)

    setLoadingScreenStatus('Placing blocks (starting viewer)')

    console.log('bot spawned - starting viewer')

    const version = bot.version

    const center = bot.entity.position

    const worldView = new WorldView(bot.world, singeplayer ? renderDistance : Math.min(renderDistance, maxMultiplayerRenderDistance), center)
    if (singeplayer) {
      const d = subscribeKey(options, 'renderDistance', () => {
        singlePlayerServer.options['view-distance'] = options.renderDistance
        worldView.viewDistance = options.renderDistance
        if (miscUiState.singleplayer) {
          window.onPlayerChangeRenderDistance?.(options.renderDistance)
        }
      })
      disposables.push(d)
    }

    let fovSetting = optionsScrn.fov
    const updateFov = () => {
      fovSetting = optionsScrn.fov
      // todo check values and add transition
      if (bot.controlState.sprint && !bot.controlState.sneak) {
        fovSetting += 5
      }
      if (gameAdditionalState.isFlying) {
        fovSetting += 5
      }
      viewer.camera.fov = fovSetting
      viewer.camera.updateProjectionMatrix()
    }
    updateFov()
    subscribeKey(gameAdditionalState, 'isFlying', updateFov)
    subscribeKey(gameAdditionalState, 'isSprinting', updateFov)
    optionsScrn.addEventListener('fov_changed', updateFov)

    viewer.setVersion(version)

    window.worldView = worldView
    window.bot = bot
    window.mcData = mcData
    window.viewer = viewer
    window.Vec3 = Vec3
    window.pathfinder = pathfinder
    window.debugMenu = debugMenu
    window.settings = optionsScrn
    window.renderer = renderer

    initVR(bot, renderer, viewer)

    const cursor = new Cursor(viewer, renderer, bot)
    postRenderFrameFn = () => {
      debugMenu.cursorBlock = cursor.cursorBlock
      viewer.setFirstPersonCamera(null, bot.entity.yaw, bot.entity.pitch)
      cursor.update(bot)
    }

    try {
      const gl = renderer.getContext()
      debugMenu.rendererDevice = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)
    } catch (err) {
      console.error(err)
      debugMenu.rendererDevice = '???'
    }

    // Link WorldView and Viewer
    viewer.listen(worldView)
    worldView.listenToBot(bot)
    worldView.init(bot.entity.position)

    updateTime(bot)

    // Bot position callback
    function botPosition () {
      // this might cause lag, but not sure
      viewer.setFirstPersonCamera(bot.entity.position, bot.entity.yaw, bot.entity.pitch)
      worldView.updatePosition(bot.entity.position)
    }
    bot.on('move', botPosition)
    botPosition()

    setLoadingScreenStatus('Setting callbacks')

    mouseMovePostHandle = ({ x, y }) => {
      bot.entity.pitch -= y
      bot.entity.pitch = Math.max(minPitch, Math.min(maxPitch, bot.entity.pitch))
      bot.entity.yaw -= x
    }

    function changeCallback () {
      notification.show = false
      if (!pointerLock.hasPointerLock && activeModalStack.length === 0) {
        showModal(pauseMenu)
      }
    }

    registerListener(document, 'pointerlockchange', changeCallback, false)

    // after what time of holding the finger start breaking the block
    const touchBreakBlockMs = 500
    let firstTouchAppeared
    let virtualTouchPressed = false
    let virtualTouchPressTimeout
    /** @type {Touch?} */
    let lastTouch
    let firstTouch
    registerListener(document, 'touchstart', (e) => {
      if (!isGameActive(true)) return
      const touch = e.touches[0]
      virtualTouchPressTimeout ??= setTimeout(() => {
        virtualTouchPressed = true
        document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
      }, touchBreakBlockMs)
      firstTouchAppeared ??= new Date()
      firstTouch ??= touch
    })
    registerListener(document, 'touchmove', (e) => {
      if (!firstTouch) return
      window.scrollTo(0, 0)
      e.preventDefault()
      e.stopPropagation()

      const touch = e.touches[0]

      const allowedJitter = 1.1
      // todo support touch.pressure (3d touch)
      const xDiff = Math.abs(touch.pageX - firstTouch.pageX) > allowedJitter
      const yDiff = Math.abs(touch.pageY - firstTouch.pageY) > allowedJitter
      if (lastTouch !== undefined) {
        if (xDiff && yDiff) {
          clearTimeout(virtualTouchPressTimeout)
        }
        onMouseMove({ movementX: touch.pageX - lastTouch.pageX, movementY: touch.pageY - lastTouch.pageY, type: 'touchmove' })
      }
      lastTouch = touch
    }, { passive: false })

    registerListener(document, 'touchend', (e) => {
      lastTouch = undefined
      firstTouch = undefined
      clearTimeout(virtualTouchPressTimeout)
      virtualTouchPressTimeout = undefined
      if (virtualTouchPressed) {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
        virtualTouchPressed = false
      } else if (Date.now() - firstTouchAppeared < touchBreakBlockMs) {
        document.dispatchEvent(new MouseEvent('mousedown', { button: 2 }))
        nextFrameFn.push(() => {
          document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }))
        })
      }
      firstTouchAppeared = undefined
    }, { passive: false })

    registerListener(document, 'contextmenu', (e) => e.preventDefault(), false)

    registerListener(document, 'blur', (e) => {
      bot.clearControlStates()
    }, false)

    setLoadingScreenStatus('Done!')
    console.log('Done!')

    hud.init(renderer, bot, host)
    hud.style.display = 'block'

    setTimeout(function () {
      errorAbortController.abort()
      if (loadingScreen.hasError) return
      // remove loading screen, wait a second to make sure a frame has properly rendered
      hideCurrentScreens()
    }, singeplayer ? 0 : 2500)
  })
}

window.addEventListener('mousedown', (e) => {
  pointerLock.requestPointerLock()
})

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return
  if (activeModalStack.length) {
    hideCurrentModal(undefined, () => {
      if (!activeModalStack.length) {
        pointerLock.justHitEscape = true
      }
    })
  } else {
    if (pointerLock.hasPointerLock) {
      document.exitPointerLock()
    } else {
      document.dispatchEvent(new Event('pointerlockchange'))
    }
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'F11') {
    e.preventDefault()
    goFullscreen(true)
  }
  if (e.code === 'KeyL') {
    console.clear()
  }
  // if (e.code === 'KeyD') {
  //   debugPitch.innerText = '0'
  // }
})

window.addEventListener('unhandledrejection', (e) => {
  // todo
  if (e.reason.message.includes('Unable to decode audio data')) {
    console.warn(e.reason)
    return
  }
})

addPanoramaCubeMap()
showModal(document.getElementById('title-screen'))
main()
