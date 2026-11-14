import { create } from 'zustand'

export type MaaUpdateKind = 'core' | 'cli' | 'resources'
export type MaaUpdateState = 'running' | 'success' | 'error'

export const MAA_UPDATE_LABELS: Record<MaaUpdateKind, string> = {
  core: 'MaaCore',
  cli: 'MAA CLI',
  resources: '资源文件',
}

export interface MaaUpdateOperation {
  /** Distinguishes this update from the next one, even of the same kind. */
  token: number
  kind: MaaUpdateKind
  state: MaaUpdateState
  startedAt: number
  finishedAt: number | null
  /** What the action is doing, such as "下载并安装". */
  detail: string
  /** The server's message once the action ends. */
  message: string
}

interface MaaUpdateStore {
  operation: MaaUpdateOperation | null
  begin: (kind: MaaUpdateKind, detail: string) => number
  finish: (token: number, state: Exclude<MaaUpdateState, 'running'>, message: string) => void
  clear: (token: number) => void
}

let nextToken = 0

/**
 * One manual MAA update at a time, shared by the config page and the island. The page owns the
 * button's loading state; this store only carries what the island needs to show while the request
 * is in flight and briefly after it ends.
 */
export const useMaaUpdateStore = create<MaaUpdateStore>((set, get) => ({
  operation: null,
  begin: (kind, detail) => {
    const token = ++nextToken
    set({
      operation: {
        token,
        kind,
        state: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        detail,
        message: '',
      },
    })
    return token
  },
  finish: (token, state, message) => {
    const current = get().operation
    if (!current || current.token !== token || current.state !== 'running') return
    set({
      operation: {
        ...current,
        state,
        message,
        finishedAt: Date.now(),
      },
    })
  },
  clear: (token) => {
    const current = get().operation
    if (!current || current.token !== token) return
    set({ operation: null })
  },
}))
