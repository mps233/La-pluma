import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

// 整页基线只保留代表页组合：dashboard 覆盖首屏布局，automation 覆盖工作区密度，
// 且只持有 desktop/mobile 与深色投影；浅色与 tablet 由局部基线（overlays、
// roguelike-settings）与浏览器像素断言兜底，控制全量基线的维护面。
const REPRESENTATIVE_TABS = ['dashboard', 'automation'] as const

const PAGE_SHELL_CONTRACT = [
  { tab: 'dashboard', layout: null, surface: null, monitor: 0, monitorLayout: null, toolbar: 0 },
  { tab: 'automation', layout: 'workspace', surface: 'borderless', monitor: 1, monitorLayout: 'workbench', toolbar: 0 },
  { tab: 'combat', layout: 'workspace', surface: 'borderless', monitor: 1, monitorLayout: 'standard', toolbar: 0 },
  { tab: 'roguelike', layout: 'workspace', surface: 'borderless', monitor: 1, monitorLayout: 'mode', toolbar: 0 },
  { tab: 'training', layout: 'workspace', surface: null, monitor: 1, monitorLayout: 'standard', toolbar: 0 },
  { tab: 'logs', layout: 'workspace', surface: 'borderless', monitor: 1, monitorLayout: 'standard', toolbar: 1 },
  { tab: 'statistics', layout: 'workspace', surface: 'borderless', monitor: 1, monitorLayout: 'standard', toolbar: 1 },
  { tab: 'config', layout: 'workspace', surface: 'borderless', monitor: 0, monitorLayout: null, toolbar: 0 },
] as const

test.describe('app tabs', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
  })

  for (const tab of REPRESENTATIVE_TABS) {
    test(`app tab: ${tab}`, async ({ page }) => {
      test.skip(test.info().project.name === 'tablet', 'tablet projection has no full-page baseline')

      const environment = await installDeterministicEnvironment(page)

      await page.goto(`/app/${tab}`)

      // 就绪标记是 fixture 驱动的 UI 文本/输入值，证明页面已完成数据渲染。
      await waitForPageReady(page, tab)

      // 就绪与字体已确认；截图断言在绘制帧后采样，不匹配时等待画面稳定。
      await expect(page).toHaveScreenshot(`${tab}-dark.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })
  }

  test('page shell anchors define stable regions for every workspace', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the region contract is checked on desktop')

    const environment = await installDeterministicEnvironment(page)

    for (const contract of PAGE_SHELL_CONTRACT) {
      await page.goto(`/app/${contract.tab}`)
      await waitForPageReady(page, contract.tab)

      if (contract.tab === 'statistics') {
        await page.getByRole('tab', { name: /掉落记录/ }).click()
        await expect(page.getByText('总理智消耗')).toBeVisible()
      }

      const pageRegion = page.locator('[data-region="page"]')
      await expect(pageRegion).toHaveCount(1)
      await expect(pageRegion).toHaveAttribute('data-page-kind', contract.tab)

      for (const anchor of ['page-header', 'page-title', 'scroll', 'page-content']) {
        await expect(page.locator(`[data-region="${anchor}"]`)).toHaveCount(1)
      }

      expect(await pageRegion.getAttribute('data-page-layout')).toBe(contract.layout)
      expect(await pageRegion.getAttribute('data-page-surface')).toBe(contract.surface)
      await expect(page.locator('[data-region="monitor"]')).toHaveCount(contract.monitor)
      if (contract.monitorLayout) {
        const monitorLayout = page.locator('[data-device-monitor-layout]')
        await expect(monitorLayout).toHaveCount(1)
        await expect(monitorLayout).toHaveAttribute('data-device-monitor-layout', contract.monitorLayout)
      } else {
        await expect(page.locator('[data-device-monitor-layout]')).toHaveCount(0)
      }
      await expect(page.locator('[data-region="toolbar"]')).toHaveCount(contract.toolbar)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('dashboard device cards keep their responsive padding', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const card = page.locator('.dashboard-device-card').first()
    await expect(card).toBeVisible()

    const expected = test.info().project.name === 'mobile' ? 16 : 14
    const padding = await card.evaluate(element => {
      const style = getComputedStyle(element)
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
        .map(value => Number.parseFloat(value))
    })

    expect(padding).toEqual([expected, expected, expected, expected])

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('page title names the active tab and drives the document title', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const title = page.locator('[data-region="page-title"]')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('概览')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(await title.evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
    expect(await title.evaluate(element => getComputedStyle(element).fontWeight)).toBe('600')
    await expect(page).toHaveTitle('概览 · La Pluma Next')

    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    await expect(title).toBeVisible()
    await expect(title).toHaveText('日常')
    await expect(page).toHaveTitle('日常 · La Pluma Next')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('skip links move focus to main content and the active navigation', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await page.keyboard.press('Tab')
    const contentSkipLink = page.getByRole('link', { name: '跳到主要内容', exact: true })
    await expect(contentSkipLink).toBeFocused()
    await expect(contentSkipLink).toBeInViewport()

    await page.keyboard.press('Enter')
    await expect(page.locator('[data-region="scroll"]')).toBeFocused()

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const navigationSkipLink = page.getByRole('link', { name: '跳到主导航', exact: true })
    await expect(navigationSkipLink).toBeFocused()
    await page.keyboard.press('Enter')
    const navigationTarget = test.info().project.name === 'desktop'
      ? '#app-sidebar-navigation'
      : '#app-tabbar-navigation'
    await expect(page.locator(navigationTarget)).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('route focus moves to main content and announces the new page', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const navButton = test.info().project.name === 'desktop'
      ? page.locator('nav[aria-label="工作台"] button[data-app-tab="automation"]')
      : page.locator('footer[data-region="tabbar"] button[data-app-tab="automation"]')
    await navButton.click()

    await expect(page).toHaveURL(/\/app\/automation$/)
    await expect(page.locator('#main-content')).toBeFocused()
    await expect(page.locator('#page-announcement')).toHaveText('已切换到日常')
    await expect(page).toHaveTitle('日常 · La Pluma Next')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('initial route normalization skips route focus and announcements', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    const navButton = test.info().project.name === 'desktop'
      ? page.locator('nav[aria-label="工作台"] button[data-app-tab="automation"]')
      : page.locator('footer[data-region="tabbar"] button[data-app-tab="automation"]')

    for (const entry of ['/', '/app', '/app/', '/app/unknown']) {
      await page.goto(entry)
      await waitForPageReady(page, 'dashboard')

      await expect(page).toHaveURL(/\/app\/dashboard$/)
      await expect(page.locator('#main-content')).not.toBeFocused()
      await expect(page.locator('#page-announcement')).toHaveText('')

      await navButton.click()

      await expect(page).toHaveURL(/\/app\/automation$/)
      await expect(page.locator('#main-content')).toBeFocused()
      await expect(page.locator('#page-announcement')).toHaveText('已切换到日常')
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('more sheet returns focus to the trigger after choosing a workspace', async ({ page }) => {
    test.skip(test.info().project.name === 'desktop', 'the overflow sheet is available below the desktop breakpoint')

    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const moreTrigger = page.getByRole('button', { name: '更多页面', exact: true })
    await moreTrigger.click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: '肉鸽', exact: true }).click()

    await expect(page).toHaveURL(/\/app\/roguelike$/)
    await expect(sheet).toBeHidden()
    await expect(moreTrigger).toBeFocused()
    await expect(page.locator('#page-announcement')).toHaveText('已切换到肉鸽')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('page title starts at the content leading edge', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const edges = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('[data-region="page-title"]')
      const content = document.querySelector<HTMLElement>('[data-region="page-content"]')
      if (!title || !content) throw new Error('page title structure missing')
      const contentLeft = content.getBoundingClientRect().left
        + Number.parseFloat(getComputedStyle(content).paddingLeft)
      return { contentLeft, titleLeft: title.getBoundingClientRect().left }
    })

    expect(Math.abs(edges.titleLeft - edges.contentLeft)).toBeLessThanOrEqual(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('desktop brand lives in the sidebar instead of the navbar', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the sidebar is desktop-only')

    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const brand = page.locator('[data-region="sidebar-brand"]')
    await expect(brand).toBeVisible()
    await expect(brand).toContainText('La Pluma Next')
    await expect(brand.locator('button, a')).toHaveCount(0)
    await expect(brand.locator('img')).toHaveAttribute('alt', '')
    await expect(brand.locator('img')).toHaveJSProperty('draggable', false)
    expect(await brand.evaluate(element => getComputedStyle(element).userSelect)).toBe('none')

    const navbar = page.locator('[data-region="navbar"]')
    await expect(navbar).not.toContainText('La Pluma Next')
    await expect(navbar.locator('img')).toHaveCount(0)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('mobile hides the sidebar brand and still shows the page title', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'the sidebar is desktop-only')

    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await expect(page.locator('[data-region="sidebar"]')).toBeHidden()
    await expect(page.locator('[data-region="sidebar-brand"]')).toBeHidden()
    await expect(page.locator('[data-region="page-title"]')).toBeVisible()
    await expect(page.locator('[data-region="page-title"]')).toHaveText('概览')
    await expect(page.locator('[data-region="navbar"]')).not.toContainText('La Pluma Next')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('theme gallery route uses its own page title', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/dev/theme-gallery')
    await waitForPageReady(page, 'gallery')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('主题画廊')
    await expect(page).toHaveTitle('主题画廊 · La Pluma Next')
    await expect(page.locator('[data-region="page"]')).toHaveAttribute('data-page-kind', 'gallery')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('pages no longer render their own page header', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await expect(page.locator('[data-region="page"] h1')).toHaveCount(0)
    await expect(page.locator('[data-region="page-header"] [data-region="page-title"]')).toHaveCount(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('navbar actions stay at the trailing edge', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const edges = await page.evaluate(() => {
      const navbarInner = document.querySelector<HTMLElement>('.la-pluma-navbar-inner')
      const actions = document.querySelector<HTMLElement>('.la-pluma-navbar-actions')
      if (!navbarInner || !actions) throw new Error('navbar structure missing')
      const innerRect = navbarInner.getBoundingClientRect()
      const paddingRight = Number.parseFloat(getComputedStyle(navbarInner).paddingRight)
      return {
        contentRight: innerRect.right - paddingRight,
        actionsRight: actions.getBoundingClientRect().right,
      }
    })

    expect(Math.abs(edges.actionsRight - edges.contentRight)).toBeLessThanOrEqual(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
