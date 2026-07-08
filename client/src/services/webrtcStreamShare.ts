/**
 * 全局 WebRTC 流共享 —— 控制台迷你预览复用主预览的视频流，不额外建立连接。
 */
let _stream: MediaStream | null = null
let _listeners: Array<(stream: MediaStream | null) => void> = []

export const webrtcStreamShare = {
  get(): MediaStream | null { return _stream },
  set(stream: MediaStream | null) {
    _stream = stream
    _listeners.forEach(fn => fn(stream))
  },
  subscribe(fn: (stream: MediaStream | null) => void) {
    _listeners.push(fn)
    return () => { _listeners = _listeners.filter(f => f !== fn) }
  }
}
