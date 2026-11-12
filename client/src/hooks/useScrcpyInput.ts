import { useCallback, useEffect, useRef, type PointerEvent, type WheelEvent } from 'react'
import type { PreviewSession } from '../contexts/previewSession'

type SendTouch = PreviewSession['sendTouch']
type SendScroll = PreviewSession['sendScroll']

interface TrackedPointer {
  clientX: number
  clientY: number
  target: HTMLVideoElement
}

interface UseScrcpyInputOptions {
  enabled: boolean
  inputReady: boolean
  sendTouch: SendTouch
  sendScroll: SendScroll
}

/**
 * Pointer, wheel and multi-touch gestures for a scrcpy video surface.
 *
 * The dashboard preview and the automation monitor render different chrome
 * around the same video, so they share this gesture layer instead of keeping
 * two subtly different copies of the pointer bookkeeping.
 */
export function useScrcpyInput({
  enabled,
  inputReady,
  sendTouch,
  sendScroll,
}: UseScrcpyInputOptions) {
  const trackedPointersRef = useRef(new Map<number, TrackedPointer>())
  const pendingPointerMovesRef = useRef(new Map<number, TrackedPointer>())
  const pointerMoveFrameRef = useRef<number | null>(null)
  const sendTouchRef = useRef(sendTouch)
  const sendScrollRef = useRef(sendScroll)

  useEffect(() => {
    sendTouchRef.current = sendTouch
  }, [sendTouch])

  useEffect(() => {
    sendScrollRef.current = sendScroll
  }, [sendScroll])

  const interactive = enabled && inputReady

  const flushPointerMoves = useCallback(() => {
    pointerMoveFrameRef.current = null
    const pendingMoves = Array.from(pendingPointerMovesRef.current.entries())
    pendingPointerMovesRef.current.clear()
    pendingMoves.forEach(([pointerId, pointer]) => {
      if (!trackedPointersRef.current.has(pointerId)) return
      sendTouchRef.current(2, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
  }, [])

  const cancelActiveGestures = useCallback(() => {
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current)
      pointerMoveFrameRef.current = null
    }
    pendingPointerMovesRef.current.clear()
    trackedPointersRef.current.forEach((pointer, pointerId) => {
      sendTouchRef.current(3, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
    trackedPointersRef.current.clear()
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLVideoElement>) => {
    if (!interactive) return
    const pointer = { clientX: event.clientX, clientY: event.clientY, target: event.currentTarget }
    if (!sendTouchRef.current(0, pointer.clientX, pointer.clientY, event.pointerId, pointer.target)) return

    trackedPointersRef.current.set(event.pointerId, pointer)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The pointer may already have ended between the down event and capture.
    }
  }

  const onWheel = (event: WheelEvent<HTMLVideoElement>) => {
    if (!interactive) return
    if (sendScrollRef.current(event.deltaX, event.deltaY, event.clientX, event.clientY, event.currentTarget)) {
      event.preventDefault()
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLVideoElement>) => {
    if (!interactive || !trackedPointersRef.current.has(event.pointerId)) return
    const pointer = { clientX: event.clientX, clientY: event.clientY, target: event.currentTarget }
    trackedPointersRef.current.set(event.pointerId, pointer)
    pendingPointerMovesRef.current.set(event.pointerId, pointer)
    if (pointerMoveFrameRef.current === null) {
      pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMoves)
    }
  }

  const finishPointer = (event: PointerEvent<HTMLVideoElement>, cancelled = false) => {
    const trackedPointer = trackedPointersRef.current.get(event.pointerId)
    if (!trackedPointer) return

    pendingPointerMovesRef.current.delete(event.pointerId)
    trackedPointersRef.current.delete(event.pointerId)
    sendTouchRef.current(
      cancelled ? 3 : 1,
      cancelled ? trackedPointer.clientX : event.clientX,
      cancelled ? trackedPointer.clientY : event.clientY,
      event.pointerId,
      trackedPointer.target,
    )
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Losing capture is already equivalent to finishing this local gesture.
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLVideoElement>) => finishPointer(event)
  const onPointerCancel = (event: PointerEvent<HTMLVideoElement>) => finishPointer(event, true)

  const onLostPointerCapture = (event: PointerEvent<HTMLVideoElement>) => {
    const trackedPointer = trackedPointersRef.current.get(event.pointerId)
    if (!trackedPointer) return
    pendingPointerMovesRef.current.delete(event.pointerId)
    trackedPointersRef.current.delete(event.pointerId)
    sendTouchRef.current(3, trackedPointer.clientX, trackedPointer.clientY, event.pointerId, trackedPointer.target)
  }

  useEffect(() => () => {
    cancelActiveGestures()
  }, [cancelActiveGestures])

  return {
    onPointerDown,
    onPointerMove,
    onWheel,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    cancelActiveGestures,
  }
}
