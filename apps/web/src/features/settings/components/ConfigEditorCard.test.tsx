// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigEditorCard from './ConfigEditorCard'
import type { ConfigEditorCardProps } from './ConfigEditorCard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const baseProps: ConfigEditorCardProps = {
  feedback: null,
  children: <div>表单内容</div>,
}

const renderCard = async (props: Partial<ConfigEditorCardProps> = {}) => {
  await act(async () => root.render(<ConfigEditorCard {...baseProps} {...props} />))
}

const findButton = (label: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`找不到按钮: ${label}`)
  return button
}

describe('ConfigEditorCard auto save shell', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders no save or reset buttons', async () => {
    await renderCard()

    const labels = [...container.querySelectorAll('button')].map(button => button.textContent?.trim())
    expect(labels).not.toContain('保存')
    expect(labels).not.toContain('重置')
  })

  it('offers an explicit retry entry after a failed read', async () => {
    const onRetryLoad = vi.fn()
    await renderCard({
      feedback: { type: 'error', message: '连接配置读取失败: 配置不可读', retry: 'load' },
      onRetryLoad,
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接配置读取失败: 配置不可读')

    await act(async () => findButton('重新读取').click())
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })

  it('offers a retry entry after a failed automatic save', async () => {
    const onRetrySave = vi.fn()
    await renderCard({
      feedback: { type: 'error', message: '连接配置保存失败: 磁盘只读', retry: 'save' },
      onRetrySave,
    })

    await act(async () => findButton('重试保存').click())
    expect(onRetrySave).toHaveBeenCalledOnce()
  })

  it('flushes when a field inside the card loses focus', async () => {
    const onFieldBlur = vi.fn()
    await renderCard({
      onFieldBlur,
      children: <input aria-label="地址" />,
    })

    const input = container.querySelector('input')
    if (!input) throw new Error('找不到输入框')
    await act(async () => {
      input.focus()
      input.blur()
    })
    expect(onFieldBlur).toHaveBeenCalled()
  })
})
