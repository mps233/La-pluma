import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'
import { buildPreviewScrcpyOptions, usePreviewStore } from '../stores'
import { maaApi } from '../services/api'
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
  const previousOptionsRef = useRef(scrcpyOptions)
  const restartingRef = useRef(false)
  useEffect(() => {
    if (previousOptionsRef.current === scrcpyOptions) return
    previousOptionsRef.current = scrcpyOptions
    if (restartingRef.current || session.status !== 'connected') return
    restartingRef.current = true
    void (async () => {
      try {
        session.disconnect()
        await maaApi.stopWebrtc().catch(() => undefined)
        const result = await maaApi.startWebrtc('default', 'mumu-la-pluma', undefined, scrcpyOptions)
        if (result.success) session.connect()
      } finally {
        restartingRef.current = false
      }
    })()
  }, [scrcpyOptions, session.status, session.connect, session.disconnect])

  const value = useMemo(() => ({ session, activeVideoRef }), [session])

  return (
    <PreviewSessionContext.Provider value={value}>
      {children}
    </PreviewSessionContext.Provider>
  )
}
