import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type RefObject,
} from 'react'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'

export type PreviewSession = ReturnType<typeof useScrcpyWebRTC>
export type PreviewHookOptions = Omit<Parameters<typeof useScrcpyWebRTC>[0], 'videoRef'>

export interface PreviewSessionContextValue {
  session: PreviewSession
  /** 当前可见页面挂载的 video；连接本身不随页面切换销毁。 */
  activeVideoRef: RefObject<HTMLVideoElement | null>
}

export const PreviewSessionContext = createContext<PreviewSessionContextValue | null>(null)

/**
 * 有 App 级 Provider 时复用唯一连接；独立组件测试没有 Provider 时回退到
 * 组件自有连接，保证页面仍可单独运行。
 */
export function usePreviewConnection(
  videoRef: RefObject<HTMLVideoElement | null>,
  options: PreviewHookOptions
): PreviewSession {
  const context = useContext(PreviewSessionContext)
  const localSession = useScrcpyWebRTC({ ...options, videoRef, passive: Boolean(context) })
  const sharedSession = context?.session ?? null
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])
  const mediaStream = context?.session.mediaStream ?? null

  useEffect(() => {
    const activeContext = contextRef.current
    if (!activeContext) return undefined
    const video = videoRef.current
    if (!video) return undefined
    activeContext.activeVideoRef.current = video
    video.srcObject = mediaStream
    if (mediaStream) void video.play().catch(() => undefined)
    return () => {
      if (activeContext.activeVideoRef.current === video) activeContext.activeVideoRef.current = null
      video.srcObject = null
    }
  }, [mediaStream, videoRef])

  return sharedSession ?? localSession
}

export function usePreviewSessionContext(): PreviewSessionContextValue | null {
  return useContext(PreviewSessionContext)
}
