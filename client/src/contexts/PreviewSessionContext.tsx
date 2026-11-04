import { useMemo, useRef, type ReactNode } from 'react'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'
import { buildPreviewScrcpyOptions, usePreviewStore } from '../stores'
import { PreviewSessionContext } from './previewSession'

/** App 级唯一的实时预览连接；页面只附着 video，不各自重新协商 WebRTC。 */
export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)
  const quality = usePreviewStore(state => state.quality)
  const fps = usePreviewStore(state => state.fps)
  const maxSize = usePreviewStore(state => state.maxSize)
  const bitrateMbps = usePreviewStore(state => state.bitrateMbps)
  const scrcpyOptions = useMemo(
    () => buildPreviewScrcpyOptions({ quality, fps, maxSize, bitrateMbps }),
    [bitrateMbps, fps, maxSize, quality]
  )
  const session = useScrcpyWebRTC({
    videoRef: activeVideoRef,
    deviceId: 'mumu-la-pluma',
    signalingUrl: '/webrtc-signaling',
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    scrcpyOptions,
  })
  const value = useMemo(() => ({ session, activeVideoRef }), [session])

  return (
    <PreviewSessionContext.Provider value={value}>
      {children}
    </PreviewSessionContext.Provider>
  )
}
