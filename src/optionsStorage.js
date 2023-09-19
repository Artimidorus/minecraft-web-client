//@ts-check
// todo implement async options storage

import { proxy, subscribe } from 'valtio/vanilla'
import { subscribeKey } from 'valtio/utils'
import { mergeAny } from './optionsStorageTypes'

const defaultOptions = {
  renderDistance: 4,
  alwaysShowMobileControls: false,
  maxMultiplayerRenderDistance: 6,
  excludeCommunicationDebugEvents: [],
  preventDevReloadWhilePlaying: false,
  numWorkers: 4
}

export const options = proxy(
  mergeAny(defaultOptions, JSON.parse(localStorage.options || '{}'))
)

window.options = options

subscribe(options, () => {
  localStorage.options = JSON.stringify(options)
})

/** @type {import('./optionsStorageTypes').WatchValue} */
export const watchValue = (proxy, callback) => {
  const watchedProps = new Set()
  callback(new Proxy(proxy, {
    get (target, p, receiver) {
      watchedProps.add(p.toString())
      return Reflect.get(target, p, receiver)
    },
  }))
  watchedProps.forEach(prop => {
    subscribeKey(proxy, prop, () => {
      callback(proxy)
    })
  })
}

watchValue(options, o => {
  globalThis.excludeCommunicationDebugEvents = o.excludeCommunicationDebugEvents
})

export const useOptionValue = (setting, valueCallback) => {
  valueCallback(setting)
  subscribe(setting, valueCallback)
}
