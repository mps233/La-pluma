// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CjkText from './CjkText'
import { resolveCjkScript } from '@/utils/cjkScript'

afterEach(cleanup)

describe('CjkText', () => {
  it('leaves a one-word Chinese heading untouched', () => {
    const { container } = render(<CjkText>控制台</CjkText>)

    expect(container.textContent).toBe('控制台')
    expect(container.querySelector('.app-cjk-breaks')).toBeNull()
    expect(container.querySelector('wbr')).toBeNull()
  })

  it('inserts one wbr at each BudouX word boundary', async () => {
    render(<CjkText>自动化任务管理系统</CjkText>)

    const span = await screen.findByText('自动化任务管理系统', { selector: 'span.app-cjk-breaks' })
    expect(span).not.toBeNull()
    expect(span.querySelectorAll('wbr')).toHaveLength(1)
    expect(span.textContent).toBe('自动化任务管理系统')
  })

  it('keeps spaces as break points instead of adding redundant wbr', async () => {
    render(<CjkText>资源配置由 MAA 管理</CjkText>)

    const span = await screen.findByText('资源配置由 MAA 管理', { selector: 'span.app-cjk-breaks' })
    expect(span).not.toBeNull()
    expect(span.querySelectorAll('wbr')).toHaveLength(0)
    expect(span.textContent).toBe('资源配置由 MAA 管理')
  })

  it('does not touch text without Han characters', () => {
    const { container } = render(<CjkText>MaaCore</CjkText>)

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
