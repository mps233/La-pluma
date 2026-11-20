// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotSearchRequest } from '../model/copilotDiscovery'
import type { CopilotSearchResult } from '../types'
import { useCopilotSearch, type UseCopilotSearchResult } from './useCopilotSearch'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  searchCopilot: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  searchCopilot: mocks.searchCopilot,
}))

const REQUEST: CopilotSearchRequest = {
  keyword: '1-7',
  level: '',
  includedOperators: [],
  excludedOperators: [],
  orderBy: 'hot',
  page: 1,
  limit: 30,
}

const pageResult = (page: number, hasNext: boolean): CopilotSearchResult => ({
  stage: '1-7',
  page,
  limit: 30,
  total: 150,
  hasNext,
  copilots: [{
    id: `page-${page}`,
    uri: `prts://page-${page}`,
    views: 1,
    hotScore: 0,
  }],
})

const envelope = (page: number, hasNext: boolean) => ({
  success: true,
  data: pageResult(page, hasNext),
})

let container: HTMLDivElement
let root: Root
let client: QueryClient
const renders: Array<UseCopilotSearchResult<CopilotSearchRequest, CopilotSearchResult>> = []

const latest = () => renders[renders.length - 1]

function Probe() {
  renders.push(useCopilotSearch(REQUEST))
  return null
}

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const renderProbe = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
  })
  await flush()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  renders.length = 0
  mocks.searchCopilot.mockReset()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  client.clear()
  vi.restoreAllMocks()
})

describe('useCopilotSearch', () => {
  it('loads another page without replacing the current result or the searching state', async () => {
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => (
      request.page === 1 ? envelope(1, true) : envelope(2, false)
    ))
    await renderProbe()

    expect(latest()?.result?.page).toBe(1)

    const pageTwo: { value: CopilotSearchResult | null } = { value: null }
    await act(async () => {
      pageTwo.value = await latest()!.loadMore({ ...REQUEST, page: 2 })
    })
    await flush()

    expect(pageTwo.value?.page).toBe(2)
    expect(latest()?.result?.page).toBe(1)
    expect(latest()?.result?.copilots.map(item => item.uri)).toEqual(['prts://page-1'])
    expect(latest()?.searching).toBe(false)
    expect(mocks.searchCopilot).toHaveBeenCalledTimes(2)
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.anything(),
    )
  })

  it('returns null and keeps the current result when the page request fails', async () => {
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => (
      request.page === 1
        ? envelope(1, true)
        : { success: false, message: '读取失败' }
    ))
    await renderProbe()

    const pageTwo: { value: CopilotSearchResult | null } = { value: pageResult(9, false) }
    await act(async () => {
      pageTwo.value = await latest()!.loadMore({ ...REQUEST, page: 2 })
    })
    await flush()

    expect(pageTwo.value).toBeNull()
    expect(latest()?.result?.page).toBe(1)
    expect(latest()?.searching).toBe(false)
    expect(latest()?.error).toBeNull()
  })

  it('reports an explicit search failure and retries the last explicit request', async () => {
    let failing = true
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => {
      if (request.keyword === 'CE-5') {
        return failing
          ? { success: false, message: '搜索接口读取失败' }
          : envelope(1, false)
      }
      return envelope(1, true)
    })
    await renderProbe()

    let status: string | null = null
    await act(async () => {
      status = (await latest()!.search({ ...REQUEST, keyword: 'CE-5' })).status
    })
    await flush()

    expect(status).toBe('failed')
    expect(latest()?.error).toBe('搜索接口读取失败')
    expect(latest()?.searching).toBe(false)

    failing = false
    await act(async () => {
      latest()!.retry()
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.result?.page).toBe(1)
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'CE-5' }),
      expect.anything(),
    )
  })

  it('clears an explicit search failure on cancel and reset', async () => {
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => (
      request.keyword === 'CE-5'
        ? { success: false, message: '搜索接口读取失败' }
        : envelope(1, true)
    ))
    await renderProbe()

    await act(async () => {
      await latest()!.search({ ...REQUEST, keyword: 'CE-5' })
    })
    await flush()
    expect(latest()?.error).toBe('搜索接口读取失败')

    await act(async () => {
      latest()!.cancel()
    })
    await flush()
    expect(latest()?.error).toBeNull()

    await act(async () => {
      await latest()!.search({ ...REQUEST, keyword: 'CE-5' })
    })
    await flush()
    expect(latest()?.error).toBe('搜索接口读取失败')

    await act(async () => {
      latest()!.reset()
    })
    await flush()
    expect(latest()?.error).toBeNull()
    expect(latest()?.result?.copilots.map(item => item.uri)).toEqual(['prts://page-1'])
  })

  it('clears the previous failure as soon as a new search starts', async () => {
    let release: (() => void) | null = null
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => {
      if (request.keyword === 'CE-5') {
        return { success: false, message: '搜索接口读取失败' }
      }
      if (request.keyword === 'LS-5') {
        return new Promise(resolve => {
          release = () => resolve(envelope(3, false))
        })
      }
      return envelope(1, true)
    })
    await renderProbe()

    await act(async () => {
      await latest()!.search({ ...REQUEST, keyword: 'CE-5' })
    })
    await flush()
    expect(latest()?.error).toBe('搜索接口读取失败')

    let pending: Promise<unknown> | null = null
    await act(async () => {
      pending = latest()!.search({ ...REQUEST, keyword: 'LS-5' })
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.searching).toBe(true)

    await act(async () => {
      release?.()
      await pending
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.searching).toBe(false)
    expect(latest()?.result?.page).toBe(3)
  })

  it('reports a default list failure instead of an empty result and retries it', async () => {
    let attempts = 0
    mocks.searchCopilot.mockImplementation(async () => {
      attempts += 1
      return attempts === 1
        ? { success: false, message: '默认列表读取失败' }
        : envelope(1, false)
    })
    await renderProbe()
    await flush()

    expect(latest()?.error).toBe('默认列表读取失败')
    expect(latest()?.result).toBeNull()

    await act(async () => {
      latest()!.retry()
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.result?.page).toBe(1)
    expect(mocks.searchCopilot).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: '1-7', page: 1 }),
      expect.anything(),
    )
  })

  it('reports a default request refresh failure', async () => {
    mocks.searchCopilot.mockImplementation(async (request: CopilotSearchRequest) => (
      request.orderBy === 'latest'
        ? { success: false, message: '默认列表刷新失败' }
        : envelope(1, true)
    ))
    await renderProbe()

    await act(async () => {
      latest()!.refreshDefault({ ...REQUEST, orderBy: 'latest' })
    })
    await flush()

    expect(latest()?.error).toBe('默认列表刷新失败')
  })

  it('keeps an explicit search success when a stale default request fails later', async () => {
    let rejectDefault: ((error: Error) => void) | null = null
    mocks.searchCopilot.mockImplementation((request: CopilotSearchRequest) => {
      if (request.keyword === '1-7') {
        return new Promise((_, reject) => {
          rejectDefault = reject
        })
      }
      return Promise.resolve(envelope(2, false))
    })
    await renderProbe()
    expect(rejectDefault).not.toBeNull()

    await act(async () => {
      await latest()!.search({ ...REQUEST, keyword: 'CE-5' })
    })
    await flush()
    expect(latest()?.error).toBeNull()
    expect(latest()?.result?.page).toBe(2)

    await act(async () => {
      rejectDefault?.(new Error('默认列表读取失败'))
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.result?.page).toBe(2)
  })

  it('does not surface a cancelled shared request after cancel and reset', async () => {
    mocks.searchCopilot.mockImplementation(() => new Promise(() => {}))
    await renderProbe()

    await act(async () => {
      latest()!.refreshDefault(REQUEST)
    })

    let pending: Promise<unknown> | null = null
    await act(async () => {
      pending = latest()!.search(REQUEST)
    })
    await flush()

    await act(async () => {
      latest()!.cancel()
      latest()!.reset()
    })
    await flush()

    expect(latest()?.error).toBeNull()
    expect(latest()?.searching).toBe(false)

    await act(async () => {
      await pending
    })
    await flush()
    expect(latest()?.error).toBeNull()
  })
})
