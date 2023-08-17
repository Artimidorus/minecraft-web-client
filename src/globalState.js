//@ts-check

import { proxy } from 'valtio'
import { pointerLock } from './utils'

// todo: refactor structure with support of hideNext=false

/**
 * @typedef {(HTMLElement & Record<string, any>)} Modal
 * @typedef {{callback, label}} ContextMenuItem
 */

/** @type {Modal[]} */
export const activeModalStack = []

export const replaceActiveModalStack = (name, newModalStack = activeModalStacks[name]) => {
  hideModal(undefined, undefined, { restorePrevious: false, force: true, })
  activeModalStack.splice(0, activeModalStack.length, ...newModalStack)
  // todo restore previous
}

/** @type {Record<string, Modal[]>} */
export const activeModalStacks = {}

window.activeModalStack = activeModalStack

export const customDisplayManageKeyword = 'custom'

const showModalInner = (/** @type {Modal} */ modal) => {
  const cancel = modal.show?.()
  if (cancel && cancel !== customDisplayManageKeyword) return false
  if (cancel !== 'custom') modal.style.display = 'block'
  return true
}

export const showModal = (/** @type {Modal} */ modal) => {
  const curModal = activeModalStack.slice(-1)[0]
  if (modal === curModal || !showModalInner(modal)) return
  if (curModal) curModal.style.display = 'none'
  activeModalStack.push(modal)
}

/**
 *
 * @param {*} data
 * @param {{ force?: boolean, restorePrevious?: boolean, }} options
 * @returns
 */
export const hideModal = (modal = activeModalStack.slice(-1)[0], data = undefined, options = {}) => {
  const { force = false, restorePrevious = true } = options
  if (!modal) return
  let cancel = modal.hide?.(data)
  if (force && cancel !== customDisplayManageKeyword) {
    cancel = undefined
  }

  if (!cancel || cancel === customDisplayManageKeyword) {
    if (cancel !== customDisplayManageKeyword) modal.style.display = 'none'
    activeModalStack.pop()
    const newModal = activeModalStack.slice(-1)[0]
    if (newModal && restorePrevious) {
      // would be great to ignore cancel I guess?
      showModalInner(newModal)
    }
    return true
  }
}

export const hideCurrentModal = (_data = undefined, preActions = undefined) => {
  if (hideModal(undefined, undefined)) {
    preActions?.()
    if (!isGameActive()) {
      showModal(document.getElementById('title-screen'))
    } else {
      pointerLock.requestPointerLock() // will work only if no modals left
    }
  }
}

// ---

export const currentContextMenu = proxy({ items: /** @type {ContextMenuItem[] | null} */[], x: 0, y: 0, })

export const showContextmenu = (/** @type {ContextMenuItem[]} */items, { clientX, clientY }) => {
  Object.assign(currentContextMenu, {
    items,
    x: clientX,
    y: clientY,
  })
}

// ---

export const isGameActive = (foregroundCheck = false) => {
  if (foregroundCheck && activeModalStack.length) return false
  return document.getElementById('hud').style.display !== 'none'
}

export const miscUiState = proxy({
  currentTouch: null
})

window.miscUiState = miscUiState
