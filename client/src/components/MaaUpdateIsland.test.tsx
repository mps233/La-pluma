// @vitest-environment jsdom

import { useEffect } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MaaUpdateIsland from './MaaUpdateIsland'
import { useMaaUpdateStore } from '@/store/maaUpdateStore'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  update: vi.fn(),
  end: vi.fn(),
  expand: vi.fn(),
  collapse: vi.fn(),
  activity: {
    id: 'la-pluma-maa-update',
    update: vi.fn(),
    end: vi.fn(),
  },
}))

vi.mock('@/lib/island', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/island')>()),
  useIslandActions: () => ({
    start: mocks.start,
    update: mocks.update,
    end: mocks.end,
    expand: mocks.expand,
    collapse: mocks.collapse,
  }),
}))

vi.mock('@/hooks/useThemeAccent', () => ({ useThemeAccent: () => '#0a84ff' }))

// The content kit only needs to accept the tree; its rendering is covered by the browser pass.
vi.mock('@/components/islandcn/use-activity', () => ({
  useActivity: (build: () => { id: string }, deps: readonly unknown[]) => {
    const options = build()
    useEffect(() => {
      mocks.start(options)
      return () => mocks.end(options.id)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the test mirror of the kit's behavior.
    }, [options.id])
    useEffect(() => {
      mocks.update(options.id, options)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the test mirror of the kit's behavior.
    }, [options.id, JSON.stringify(deps)])
    return {
      id: mocks.activity.id,
      alert: vi.fn(),
      expand: vi.fn(),
      collapse: vi.fn(),
    }
  },
}))

vi.mock('@/components/islandcn/glyph', () => ({ Glyph: () => null }))
vi.mock('@/components/islandcn/glyphs', () => ({
  CheckCircleGlyph: () => null,
  DownloadGlyph: () => null,
  PackageGlyph: () => null,
  TerminalGlyph: () => null,
  WarningGlyph: () => null,
}))
vi.mock('@/components/islandcn/island-layout', () => ({
  ExpandedBottom: ({ children }: { children?: unknown }) => children,
  SensorRow: ({ children }: { children?: unknown }) => children,
}))
vi.mock('@/components/islandcn/island-text', () => ({
  Caption: ({ children }: { children?: unknown }) => children,
  CompactText: ({ children }: { children?: unknown }) => children,
  ContextLabel: ({ children }: { children?: unknown }) => children,
  ExpandedSubtitle: ({ children }: { children?: unknown }) => children,
  ExpandedTitle: ({ children }: { children?: unknown }) => children,
  MinimalPair: () => null,
  withBubble: (compact: unknown) => compact,
}))
vi.mock('@/components/islandcn/spinner', () => ({ Spinner: () => null }))
vi.mock('@/components/islandcn/ticking-time', () => ({ TickingTime: () => null }))

afterEach(cleanup)

describe('MaaUpdateIsland', () => {
  afterEach(() => {
    cleanup()
    useMaaUpdateStore.setState({ operation: null })
    vi.clearAllMocks()
  })

  const mount = () => render(<MaaUpdateIsland />)

  it('stays out of the island when no update runs', () => {
    useMaaUpdateStore.setState({ operation: null })
    mount()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('reports a running update with its own id and label', async () => {
    const token = useMaaUpdateStore.getState().begin('cli', '替换 CLI 可执行文件')
    mount()

    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.start.mock.calls[0]?.[0]).toMatchObject({
      id: 'la-pluma-maa-update',
      priority: 2,
      label: 'MAA CLI 更新中：替换 CLI 可执行文件',
    })

    await act(async () => {
      useMaaUpdateStore.getState().finish(token, 'success', 'MAA CLI 已更新到 0.7.8')
    })

    await waitFor(() => {
      const last = mocks.update.mock.calls.at(-1)?.[1]
      expect(last?.label).toBe('MAA CLI 已更新：MAA CLI 已更新到 0.7.8')
    })
  })

  it('ends the activity when the operation clears', async () => {
    const token = useMaaUpdateStore.getState().begin('core', '下载 MaaCore 与资源')
    mount()
    await act(async () => useMaaUpdateStore.getState().clear(token))

    await waitFor(() => expect(mocks.end).toHaveBeenCalledWith('la-pluma-maa-update'))
  })
})
