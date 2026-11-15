import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  THEMES,
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

/**
 * 弹层视觉基线：portal 渲染到 document.body 的筛选菜单与 PWA 提示。
 * 这些表面不在 `.la-pluma-app` 作用域内，材质/遮罩/定位只由 portal 处的 CSS 决定；
 * tab 基线只截默认状态覆盖不到，所以单独截"打开"状态，且均为视口截图
 * （弹层按视口定位，fullPage 会把 fixed 元素拉到整页顶部）。
 */
for (const theme of THEMES) {
  test.describe(`overlays: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      recordBrowserErrors(page)
      await page.addInitScript(themeSeedScript(theme))
    })

    test(`statistics filter menu ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page)

      await page.goto('/app/statistics')
      await waitForPageReady(page, 'statistics')

      await page.getByRole('button', { name: '拥有状态' }).first().click()
      await page.getByRole('menu', { name: '拥有状态筛选' }).waitFor({ state: 'visible' })

      await expect(page).toHaveScreenshot(`statistics-filter-menu-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`pwa install prompt ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page)

      await page.goto('/app/dashboard')
      await waitForPageReady(page, 'dashboard')

      // 桌面的 beforeinstallprompt 由 Chromium 在真实安装条件下触发；
      // 基线环境只关心展示样式，直接在挂载后派发同名事件。
      await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeinstallprompt'))
      })

      await page.locator('[aria-label="安装 La Pluma Next"], #pwa-prompt-title').first()
        .waitFor({ state: 'visible' })

      await expect(page).toHaveScreenshot(`pwa-install-prompt-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })
  })
}
