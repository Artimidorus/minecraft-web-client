import { defineConfig, mergeRsbuildConfig, RsbuildPluginAPI } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTypedCSSModules } from '@rsbuild/plugin-typed-css-modules'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import { pluginTypeCheck } from '@rsbuild/plugin-type-check'
import path from 'path'
import childProcess from 'child_process'
import fs from 'fs'
import fsExtra from 'fs-extra'
import { promisify } from 'util'
import { generateSW } from 'workbox-build'
import { getSwAdditionalEntries } from './scripts/build'
import { appAndRendererSharedConfig } from './renderer/rsbuildSharedConfig'

//@ts-ignore
try { require('./localSettings.js') } catch { }

const execAsync = promisify(childProcess.exec)

const buildingVersion = new Date().toISOString().split(':')[0]

const dev = process.env.NODE_ENV === 'development'
const disableServiceWorker = process.env.DISABLE_SERVICE_WORKER === 'true'

let releaseTag
let releaseLink
let releaseChangelog

if (fs.existsSync('./assets/release.json')) {
    const releaseJson = JSON.parse(fs.readFileSync('./assets/release.json', 'utf8'))
    releaseTag = releaseJson.latestTag
    releaseLink = releaseJson.isCommit ? `/commit/${releaseJson.latestTag}` : `/releases/${releaseJson.latestTag}`
    releaseChangelog = releaseJson.changelog?.replace(/<!-- bump-type:[\w]+ -->/, '')
}

// base options are in ./renderer/rsbuildSharedConfig.ts
const appConfig = defineConfig({
    html: {
        template: './index.html',
    },
    output: {
        externals: [
            'sharp'
        ],
        sourceMap: {
            js: 'source-map',
            css: true,
        },
    },
    source: {
        entry: {
            index: './src/index.ts',
        },
        // exclude: [
        //     /.woff$/
        // ],
        define: {
            'process.env.BUILD_VERSION': JSON.stringify(!dev ? buildingVersion : 'undefined'),
            'process.env.MAIN_MENU_LINKS': JSON.stringify(process.env.MAIN_MENU_LINKS),
            'process.env.GITHUB_URL':
                JSON.stringify(`https://github.com/${process.env.GITHUB_REPOSITORY || `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`}`),
            'process.env.DEPS_VERSIONS': JSON.stringify({}),
            'process.env.RELEASE_TAG': JSON.stringify(releaseTag),
            'process.env.RELEASE_LINK': JSON.stringify(releaseLink),
            'process.env.RELEASE_CHANGELOG': JSON.stringify(releaseChangelog),
            'process.env.DISABLE_SERVICE_WORKER': JSON.stringify(disableServiceWorker),
        },
    },
    server: {
        // strictPort: true,
        // publicDir: {
        //     name: 'assets',
        // },
        proxy: {
            '/api': 'http://localhost:8080',
        },
    },
    plugins: [
        pluginTypedCSSModules(),
        {
            name: 'test',
            setup (build: RsbuildPluginAPI) {
                const prep = async () => {
                    console.time('total-prep')
                    fs.mkdirSync('./generated', { recursive: true })
                    if (!fs.existsSync('./generated/minecraft-data-optimized.json') || require('./generated/minecraft-data-optimized.json').versionKey !== require('minecraft-data/package.json').version) {
                        childProcess.execSync('tsx ./scripts/makeOptimizedMcData.mjs', { stdio: 'inherit' })
                    }
                    childProcess.execSync('tsx ./scripts/genShims.ts', { stdio: 'inherit' })
                    if (!fs.existsSync('./generated/latestBlockCollisionsShapes.json') || require('./generated/latestBlockCollisionsShapes.json').versionKey !== require('minecraft-data/package.json').version) {
                        childProcess.execSync('tsx ./scripts/optimizeBlockCollisions.ts', { stdio: 'inherit' })
                    }
                    fsExtra.copySync('./node_modules/mc-assets/dist/other-textures/latest/entity', './dist/textures/entity')
                    fsExtra.copySync('./assets/background', './dist/background')
                    fs.copyFileSync('./assets/favicon.png', './dist/favicon.png')
                    fs.copyFileSync('./assets/playground.html', './dist/playground.html')
                    fs.copyFileSync('./assets/manifest.json', './dist/manifest.json')
                    fs.copyFileSync('./assets/loading-bg.jpg', './dist/loading-bg.jpg')
                    if (fs.existsSync('./assets/release.json')) {
                        fs.copyFileSync('./assets/release.json', './dist/release.json')
                    }
                    const configJson = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
                    let configLocalJson = {}
                    try {
                        configLocalJson = JSON.parse(fs.readFileSync('./config.local.json', 'utf8'))
                    } catch (err) {}
                    if (dev) {
                        configJson.defaultProxy = ':8080'
                    }
                    fs.writeFileSync('./dist/config.json', JSON.stringify({ ...configJson, ...configLocalJson }), 'utf8')
                    if (fs.existsSync('./generated/sounds.js')) {
                        fs.copyFileSync('./generated/sounds.js', './dist/sounds.js')
                    }
                    // childProcess.execSync('./scripts/prepareSounds.mjs', { stdio: 'inherit' })
                    // childProcess.execSync('tsx ./scripts/genMcDataTypes.ts', { stdio: 'inherit' })
                    // childProcess.execSync('tsx ./scripts/genPixelartTypes.ts', { stdio: 'inherit' })
                    if (fs.existsSync('./renderer/dist/mesher.js') && dev) {
                        // copy mesher
                        fs.copyFileSync('./renderer/dist/mesher.js', './dist/mesher.js')
                        fs.copyFileSync('./renderer/dist/mesher.js.map', './dist/mesher.js.map')
                    } else if (!dev) {
                        await execAsync('pnpm run build-mesher')
                    }
                    fs.writeFileSync('./dist/version.txt', buildingVersion, 'utf-8')
                    console.timeEnd('total-prep')
                }
                if (!dev) {
                    build.onBeforeBuild(async () => {
                        prep()
                    })
                    build.onAfterBuild(async () => {
                        if (!disableServiceWorker) {
                            const { count, size, warnings } = await generateSW({
                                // dontCacheBustURLsMatching: [new RegExp('...')],
                                globDirectory: 'dist',
                                skipWaiting: true,
                                clientsClaim: true,
                                additionalManifestEntries: getSwAdditionalEntries(),
                                globPatterns: [],
                                swDest: './dist/service-worker.js',
                            })
                        }
                    })
                }
                build.onBeforeStartDevServer(() => prep())
            },
        },
    ],
    // performance: {
    //     bundleAnalyze: {
    //         analyzerMode: 'json',
    //         reportFilename: 'report.json',
    //     },
    // },
})

export default mergeRsbuildConfig(
    appAndRendererSharedConfig(),
    appConfig
)
