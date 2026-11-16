import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { BOOT_THEME_COLORS } from '../../src/shared/theme/bootTheme'
import {
  THEMES,
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

/**
 * 启动壳基线：abort 入口模块（assets/index-*.js）让 React 不执行，页面停在 index.html 的内联启动壳上。
 * safe-area、dvh 与 standalone 的 viewport 变量只有在真实浏览器里才生效。
 */
for (const theme of THEMES) {
  test(`boot-shell ${theme}`, async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'boot shell is captured once per theme on desktop')

    await page.addInitScript(themeSeedScript(theme))
    recordBrowserErrors(page)
    const environment = await installDeterministicEnvironment(page)
    await page.route('**/assets/index-*.js', route => route.abort())

    await page.goto('/app/dashboard')
    await page.locator('[role="status"][aria-label="正在打开 La Pluma Next"]').waitFor({ state: 'visible' })
    await page.evaluate(() => document.fonts.ready)

    await expect(page).toHaveScreenshot(`boot-shell-${theme}.png`, {
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    })

    // PWA theme-color 双机制：入口 JS 被 abort，meta 停留在构建期注入的深色默认值，
    // 运行时 Provider 的改写机制在此状态不可达。
    if (theme === 'dark') {
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        BOOT_THEME_COLORS.dark.themeColor,
      )
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
}

test('boot shell header matches the live navbar height', async ({ page }) => {
  recordBrowserErrors(page)
  await page.addInitScript(themeSeedScript('dark'))
  const environment = await installDeterministicEnvironment(page)

  await page.goto('/app/dashboard')
  await waitForPageReady(page, 'dashboard')

  const navbarHeight = await page.locator('[data-region="navbar"]').evaluate(element =>
    element.getBoundingClientRect().height)
  expect(navbarHeight).toBeGreaterThan(0)

  await page.route('**/assets/index-*.js', route => route.abort())
  await page.reload()
  await page.locator('[role="status"][aria-label="正在打开 La Pluma Next"]').waitFor({ state: 'visible' })

  const bootHeaderHeight = await page.locator('.la-pluma-boot-header').evaluate(element =>
    element.getBoundingClientRect().height)

  expect(bootHeaderHeight).toBe(navbarHeight)

  environment.assertNoUnmatchedApi()
  await expectNoBrowserErrors(page)
})
