import { SNAPSHOT_INTERVAL_SECONDS } from '../constants'
import type { PreviewMode } from '../store/previewStore'

export type PreviewLiveStatus =
  | 'idle'
  | 'connecting'
  | 'signaling'
  | 'waiting_offer'
  | 'connecting_webrtc'
  | 'connected'
  | 'disconnected'
  | 'error'

export type PreviewPhase =
  | 'off'
  | 'paused'
  | 'unavailable'
  | 'live-connecting'
  | 'live-connected'
  | 'live-disconnected'
  | 'live-error'
  | 'snapshot-loading'
  | 'snapshot-ready'
  | 'snapshot-stale'
  | 'snapshot-error'

export type PreviewTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type PreviewErrorScope = 'live' | 'snapshot' | 'infrastructure'

export type PreviewRetryTarget = 'live' | 'snapshot' | 'infrastructure'

export interface PreviewError {
  scope: PreviewErrorScope
  title: string
  message: string
}

export interface PreviewRetry {
  target: PreviewRetryTarget
  label: string
}

export interface PreviewStatus {
  phase: PreviewPhase
  label: string
  emptyTitle: string
  tone: PreviewTone
  error: PreviewError | null
  retry: PreviewRetry | null
  hasFrame: boolean
  snapshotStale: boolean
}

export interface PreviewStatusInput {
  mode: PreviewMode
  available: boolean
  paused: boolean
  liveStatus: PreviewLiveStatus
  liveError: string | null
  snapshotHasImage: boolean
  snapshotError: string | null
  infrastructureError: string | null
}

const PHASE_PRESENTATION: Record<PreviewPhase, { label: string; emptyTitle: string; tone: PreviewTone }> = {
  off: { label: '预览已关闭', emptyTitle: '预览已关闭', tone: 'neutral' },
  paused: { label: '后台已暂停', emptyTitle: '后台已暂停', tone: 'neutral' },
  unavailable: { label: '自动化服务不可用', emptyTitle: '自动化服务不可用', tone: 'warning' },
  'live-connecting': { label: '正在连接实时画面', emptyTitle: '正在连接实时画面', tone: 'info' },
  'live-connected': { label: '实时画面', emptyTitle: '实时画面', tone: 'success' },
  'live-disconnected': { label: '实时预览已断开', emptyTitle: '实时预览已断开', tone: 'warning' },
  'live-error': { label: '实时预览失败', emptyTitle: '实时预览失败', tone: 'danger' },
  'snapshot-loading': { label: '正在获取快照', emptyTitle: '正在获取快照', tone: 'info' },
  'snapshot-ready': { label: `画面快照 · ${SNAPSHOT_INTERVAL_SECONDS}s`, emptyTitle: '画面快照', tone: 'info' },
  'snapshot-stale': { label: '画面快照更新失败', emptyTitle: '画面快照更新失败', tone: 'danger' },
  'snapshot-error': { label: '画面快照失败', emptyTitle: '画面快照失败', tone: 'danger' },
}

export function derivePreviewStatus(input: PreviewStatusInput): PreviewStatus {
  const live = input.mode === 'live'
  const snapshot = input.mode === 'snapshot'
  const liveFailed = live && (Boolean(input.liveError) || input.liveStatus === 'error')
  const snapshotFailed = snapshot && Boolean(input.snapshotError)
  const liveDisconnected = live && input.liveStatus === 'disconnected'
  const infrastructureFailed = Boolean(input.infrastructureError)

  const error: PreviewError | null = !input.available
    ? infrastructureFailed
      ? { scope: 'infrastructure', title: '预览服务状态异常', message: input.infrastructureError ?? '无法读取预览服务状态' }
      : null
    : liveFailed
      ? { scope: 'live', title: '实时预览失败', message: input.liveError ?? '实时预览连接失败，请重新连接' }
      : snapshotFailed
        ? { scope: 'snapshot', title: '画面快照失败', message: input.snapshotError ?? '画面快照获取失败' }
        : infrastructureFailed
          ? { scope: 'infrastructure', title: '预览服务状态异常', message: input.infrastructureError ?? '无法读取预览服务状态' }
          : null

  let phase: PreviewPhase
  if (input.mode === 'off') {
    phase = 'off'
  } else if (input.paused) {
    phase = 'paused'
  } else if (!input.available) {
    phase = 'unavailable'
  } else if (live) {
    if (liveFailed) phase = 'live-error'
    else if (input.liveStatus === 'connected') phase = 'live-connected'
    else if (liveDisconnected) phase = 'live-disconnected'
    else phase = 'live-connecting'
  } else {
    if (snapshotFailed) phase = input.snapshotHasImage ? 'snapshot-stale' : 'snapshot-error'
    else phase = input.snapshotHasImage ? 'snapshot-ready' : 'snapshot-loading'
  }

  const retry: PreviewRetry | null = error?.scope === 'infrastructure'
    ? { target: 'infrastructure', label: '刷新状态' }
    : error?.scope === 'snapshot'
      ? { target: 'snapshot', label: '重试' }
      : error?.scope === 'live' && input.available
        ? { target: 'live', label: '重试' }
        : liveDisconnected && input.available
          ? { target: 'live', label: '重新连接' }
          : null

  const presentation = PHASE_PRESENTATION[phase]

  return {
    phase,
    label: presentation.label,
    emptyTitle: presentation.emptyTitle,
    tone: presentation.tone,
    error,
    retry,
    hasFrame: phase === 'live-connected' || phase === 'snapshot-ready' || phase === 'snapshot-stale',
    snapshotStale: phase === 'snapshot-stale',
  }
}
