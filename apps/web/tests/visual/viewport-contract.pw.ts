import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { installDeterministicEnvironment, themeSeedScript, waitForPageReady } from './harness'

const VIEWPORT_HEIGHT_TOKENS = ['--boot-viewport-height', '--layout-viewport-height'] as const

const COPILOT_QUEUE_STORAGE_KEY = 'la-pluma-copilot-queue-v1'
const COPILOT_QUEUE_ENTRY = {
  id: 'viewport-contract-queue-1',
  source: 'link',
  uri: 'maa://10086',
  title: '视口契约作业',
  details: '用于视口契约检查的作业详情',
  stage: '1-7',
  addedAt: 0,
}

async function heightToken(page: Page, token: string): Promise<string> {
  return page.evaluate(name => (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  ), token)
}

async function elementGeometry(element: Locator) {
  return element.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
    }
  })
}

async function expectDialogInsideViewport(dialog: Locator) {
  await expect.poll(async () => {
    const geometry = await elementGeometry(dialog)
    return geometry.height <= geometry.viewportHeight - 32
      && geometry.top >= 0
      && geometry.bottom <= geometry.viewportHeight
  }, { message: '弹层应保持在视口内并至少留出 2rem 的高度差' }).toBe(true)
}

async function expectScrollHostMatchesViewport(page: Page) {
  await expect.poll(async () => {
    const geometry = await elementGeometry(page.locator('[data-region="scroll"]'))
    return geometry.height > 0
      && geometry.top >= 0
      && Math.abs(geometry.bottom - geometry.viewportHeight) <= 1
  }, { message: '滚动宿主应占满应用壳的视口高度并与 innerHeight 对齐' }).toBe(true)
}

async function expectSheetBottomAnchoredInsideViewport(sheet: Locator) {
  await expect.poll(async () => {
    const geometry = await elementGeometry(sheet)
    return geometry.height > 0
      && geometry.height <= geometry.viewportHeight
      && Math.abs(geometry.bottom - geometry.viewportHeight) <= 1
  }, { message: '底部 Sheet 应保持在视口内并贴住视口底边' }).toBe(true)
}

async function seedCopilotQueue(page: Page) {
  await page.addInitScript(({ storageKey, entry }) => {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, entries: [entry] }))
  }, { storageKey: COPILOT_QUEUE_STORAGE_KEY, entry: COPILOT_QUEUE_ENTRY })
}

test.describe('viewport contract', () => {
  test('declares interactive widget resizing in the viewport meta', async ({ page }) => {
    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const viewportMeta = page.locator('meta[name="viewport"]')
    await expect(viewportMeta).toHaveCount(1)
    const content = await viewportMeta.getAttribute('content')
    expect(content).toContain('width=device-width')
    expect(content).toContain('initial-scale=1.0')
    expect(content).toContain('viewport-fit=cover')
    expect(content).toContain('interactive-widget=resizes-content')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps shell viewport height on browser and standalone CSS branches', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'explicit viewport sizes are exercised once')

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')
    for (const token of VIEWPORT_HEIGHT_TOKENS) {
      expect(await heightToken(page, token)).toBe('100dvh')
    }
    await expectScrollHostMatchesViewport(page)

    await page.setViewportSize({ width: 390, height: 844 })
    for (const token of VIEWPORT_HEIGHT_TOKENS) {
      expect(await heightToken(page, token)).toBe('100dvh')
    }
    await expectScrollHostMatchesViewport(page)

    await page.evaluate(() => document.documentElement.classList.add('la-pluma-standalone'))
    for (const token of VIEWPORT_HEIGHT_TOKENS) {
      expect(
        await heightToken(page, token),
        'la-pluma-standalone 只代理 standalone 的 CSS 分支，不代表 iOS 真机行为',
      ).toBe('100lvh')
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps a long dialog and its scrollable body inside the viewport', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'explicit viewport sizes are exercised once')

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/training')
    await waitForPageReady(page, 'training')
    await page.getByRole('button', { name: '添加干员', exact: true }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: '添加干员' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('搜索干员名称')).toBeVisible()
    await expectDialogInsideViewport(dialog)

    await page.setViewportSize({ width: 390, height: 520 })
    await expectDialogInsideViewport(dialog)

    const body = dialog.locator('[data-slot="dialog-body"]')
    await expect(body).toBeVisible()
    await expect.poll(() => body.evaluate(element => element.scrollHeight > element.clientHeight))
      .toBe(true)

    await expectDialogInsideViewport(dialog)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps the mobile copilot detail sheet inside a short viewport', async ({ page }) => {
    test.skip(
      !['desktop', 'mobile'].includes(test.info().project.name),
      'the short-viewport sheet is exercised once on desktop and once on mobile',
    )

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    await seedCopilotQueue(page)
    const environment = await installDeterministicEnvironment(page)

    await page.setViewportSize({ width: 390, height: 480 })
    await page.goto('/app/combat')
    await waitForPageReady(page, 'combat')
    await page.getByRole('button', {
      name: '查看队列第 1 项详情 视口契约作业',
      exact: true,
    }).click()

    const sheet = page.locator('[data-slot="sheet-content"]').filter({ hasText: '视口契约作业' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('data-side', 'bottom')
    await expectSheetBottomAnchoredInsideViewport(sheet)

    const geometry = await elementGeometry(sheet)
    expect(geometry.height).toBeGreaterThan(0)
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight)
    expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
