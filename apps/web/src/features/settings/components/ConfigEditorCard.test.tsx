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
  title: '连接配置',
  feedback: null,
  saving: false,
  onSave: () => {},
  onReset: () => {},
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

describe('ConfigEditorCard save gating', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('disables save and exposes the blocked reason while the config is not loaded', async () => {
    const onSave = vi.fn()
    await renderCard({
      saveDisabled: true,
      saveBlockedReason: '连接配置正在读取，加载完成后才能保存',
      onSave,
    })

    const saveButton = findButton('保存')
    expect(saveButton.disabled).toBe(true)

    const blocked = container.querySelector('[role="status"]')
    expect(blocked?.textContent).toBe('连接配置正在读取，加载完成后才能保存')

    await act(async () => saveButton.click())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('enables save and drops the blocked reason once the config is loaded', async () => {
    const onSave = vi.fn()
    await renderCard({
      saveDisabled: false,
      saveBlockedReason: null,
      onSave,
    })

    const saveButton = findButton('保存')
    expect(saveButton.disabled).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()

    await act(async () => saveButton.click())
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('does not stack the blocked reason on top of an existing load error feedback', async () => {
    await renderCard({
      feedback: { type: 'error', message: '连接配置读取失败: 网络错误' },
      saveDisabled: true,
      saveBlockedReason: '连接配置读取失败，暂时无法保存',
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    const errorFeedback = container.querySelector('[role="alert"]')
    expect(errorFeedback?.textContent).toBe('连接配置读取失败: 网络错误')
  })

  it('disables reset while the first server read is not adopted yet', async () => {
    const onReset = vi.fn()
    await renderCard({ editingDisabled: true, onReset })

    const resetButton = findButton('重置')
    expect(resetButton.disabled).toBe(true)

    await act(async () => resetButton.click())
    expect(onReset).not.toHaveBeenCalled()
  })

  it('offers an explicit retry entry after a failed read', async () => {
    const onRetryLoad = vi.fn()
    await renderCard({
      feedback: { type: 'error', message: '连接配置读取失败: 配置不可读' },
      onRetryLoad,
    })

    const retryButton = findButton('重新读取')
    expect(retryButton.disabled).toBe(false)

    await act(async () => retryButton.click())
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })
})
