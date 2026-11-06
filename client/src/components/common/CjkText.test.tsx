// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CjkText from './CjkText'
import { resolveCjkScript } from '@/utils/cjkScript'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('CjkText', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('leaves a one-word Chinese heading untouched', async () => {
    await act(async () => root.render(<CjkText>控制台</CjkText>))

    expect(container.textContent).toBe('控制台')
    expect(container.querySelector('.app-cjk-breaks')).toBeNull()
    expect(container.querySelector('wbr')).toBeNull()
  })

  it('inserts one wbr at each BudouX word boundary', async () => {
    await act(async () => root.render(<CjkText>自动化任务管理系统</CjkText>))

    const span = container.querySelector('.app-cjk-breaks')
    expect(span).not.toBeNull()
    expect(span?.querySelectorAll('wbr')).toHaveLength(1)
    expect(span?.textContent).toBe('自动化任务管理系统')
  })

  it('keeps spaces as break points instead of adding redundant wbr', async () => {
    await act(async () => root.render(<CjkText>资源配置由 MAA 管理</CjkText>))

    const span = container.querySelector('.app-cjk-breaks')
    expect(span).not.toBeNull()
    expect(span?.querySelectorAll('wbr')).toHaveLength(0)
    expect(span?.textContent).toBe('资源配置由 MAA 管理')
  })

  it('does not touch text without Han characters', async () => {
    await act(async () => root.render(<CjkText>MaaCore</CjkText>))

    expect(container.textContent).toBe('MaaCore')
    expect(container.querySelector('.app-cjk-breaks')).toBeNull()
  })

  it('resolves Simplified and Traditional language tags', () => {
    expect(resolveCjkScript('zh-CN')).toBe('hans')
    expect(resolveCjkScript('zh-Hans')).toBe('hans')
    expect(resolveCjkScript('')).toBe('hans')
    expect(resolveCjkScript('zh-TW')).toBe('hant')
    expect(resolveCjkScript('zh-HK')).toBe('hant')
    expect(resolveCjkScript('zh-Hant')).toBe('hant')
  })
})
