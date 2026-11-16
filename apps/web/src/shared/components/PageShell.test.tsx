// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PageShell from './PageShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('PageShell', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('exposes the page region contract for a workspace page', async () => {
    await act(async () => root.render(
      <PageShell pageKind="automation" layout="workspace" surface="borderless">
        <p>工作区内容</p>
      </PageShell>,
    ))

    const page = container.querySelector<HTMLElement>('[data-region="page"]')!
    expect(page.dataset.pageKind).toBe('automation')
    expect(page.dataset.pageLayout).toBe('workspace')
    expect(page.dataset.pageSurface).toBe('borderless')
    expect(page.textContent).toBe('工作区内容')
  })

  it('omits optional layout attributes and forwards native div attributes', async () => {
    await act(async () => root.render(
      <PageShell pageKind="gallery" aria-busy="true" aria-label="画廊加载中">
        <p>画廊内容</p>
      </PageShell>,
    ))

    const page = container.querySelector<HTMLElement>('[data-region="page"]')!
    expect(page.dataset.pageKind).toBe('gallery')
    expect(page.hasAttribute('data-page-layout')).toBe(false)
    expect(page.hasAttribute('data-page-surface')).toBe(false)
    expect(page.getAttribute('aria-busy')).toBe('true')
    expect(page.getAttribute('aria-label')).toBe('画廊加载中')
  })
})
