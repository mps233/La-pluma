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

  test('page title starts at the content leading edge', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    const edges = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('[data-region="page-title"]')
      const content = document.querySelector<HTMLElement>('.la-pluma-content')
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

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('pages no longer render their own page header', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await expect(page.locator('.app-page-header, .app-page-title')).toHaveCount(0)

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
