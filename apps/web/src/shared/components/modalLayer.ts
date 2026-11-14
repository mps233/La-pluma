import { useEffect, useId, type RefObject } from 'react'

const MODAL_LAYER_BASE_Z_INDEX = 80
const modalStack: string[] = []
const modalLayers = new Map<string, HTMLElement>()
const backgroundState = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>()
let scrollLockCount = 0
let previousBodyOverflow = ''

function updateModalStack() {
  const topId = modalStack[modalStack.length - 1]
  modalStack.forEach((id, index) => {
    const layer = modalLayers.get(id)
    if (!layer) return
    layer.inert = id !== topId
    if (id === topId) layer.removeAttribute('aria-hidden')
    else layer.setAttribute('aria-hidden', 'true')
    layer.style.zIndex = String(MODAL_LAYER_BASE_Z_INDEX + index)
  })
}

export function registerModal(id: string, layer: HTMLElement) {
  modalStack.push(id)
  modalLayers.set(id, layer)
  updateModalStack()
}

export function unregisterModal(id: string) {
  const index = modalStack.lastIndexOf(id)
  if (index >= 0) modalStack.splice(index, 1)
  modalLayers.delete(id)
  updateModalStack()
}

export function lockBackground() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    Array.from(document.body.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child.dataset.appModalLayer === 'true') return
      backgroundState.set(child, {
        inert: child.inert,
        ariaHidden: child.getAttribute('aria-hidden'),
      })
      child.inert = true
      child.setAttribute('aria-hidden', 'true')
    })
  }
  scrollLockCount += 1
}

export function unlockBackground() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount > 0) return

  document.body.style.overflow = previousBodyOverflow
  backgroundState.forEach((state, element) => {
    element.inert = state.inert
    if (state.ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', state.ariaHidden)
  })
  backgroundState.clear()
}

export function isTopModal(id: string) {
  return modalStack[modalStack.length - 1] === id
}

/**
 * 把已有的 portal 图层登记进 Modal 栈，供需要叠在弹窗之上的自定义抽屉使用。
 * 登记期间该层按栈序取得 z-index，非顶层弹窗会被设为 inert；停用后图层恢复自身样式。
 */
export function useModalLayer(ref: RefObject<HTMLElement | null>, enabled = true): void {
  const generatedId = useId().replace(/:/g, '')

  useEffect(() => {
    const layer = ref.current
    if (!enabled || !layer) return
    const layerId = `layer-${generatedId}`
    layer.setAttribute('data-app-modal-layer', 'true')
    registerModal(layerId, layer)
    lockBackground()
    return () => {
      unregisterModal(layerId)
      unlockBackground()
      layer.removeAttribute('data-app-modal-layer')
      layer.style.removeProperty('z-index')
    }
  }, [enabled, generatedId, ref])
}
