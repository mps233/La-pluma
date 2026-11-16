import { expect, test, type Locator } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  THEMES,
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

/**
 * 弹层视觉基线：portal 渲染到 document.body 的 PWA 提示。
 * 这些表面不在 `.la-pluma-app` 作用域内，材质/遮罩/定位只由 portal 处的 CSS 决定；
 * tab 基线只截默认状态覆盖不到，所以单独截"打开"状态，且均为视口截图
 * （弹层按视口定位，fullPage 会把 fixed 元素拉到整页顶部）。
 * 组件级弹层（DropdownMenu、toast）由主题画廊的 locator 基线覆盖。
 */
for (const theme of THEMES) {
  test.describe(`overlays: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      recordBrowserErrors(page)
      await page.addInitScript(themeSeedScript(theme))
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

test.describe('floating PWA offsets', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the install prompt one spacing step above the tabbar', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'the compact install entry is only offered below the sm breakpoint')

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page)

    await page.goto('/app/dashboard')
    await waitForPageReady(page, 'dashboard')

    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeinstallprompt'))
    })

    const gapAboveTabbar = (target: Locator) => target.evaluate(element => {
      const tabbar = document.querySelector<HTMLElement>('[data-region="tabbar"]')
      if (!tabbar) throw new Error('tabbar region is missing')
      return tabbar.getBoundingClientRect().top - element.getBoundingClientRect().bottom
    })

    const installEntry = page.getByRole('button', { name: '安装 La Pluma Next' })
    await expect(installEntry).toBeVisible()
    expect(await gapAboveTabbar(installEntry)).toBeCloseTo(16, 1)

    await installEntry.click()

    const installPrompt = page.getByRole('region', { name: '安装 La Pluma Next' })
    await expect(installPrompt).toBeVisible()
    expect(await gapAboveTabbar(installPrompt)).toBeCloseTo(16, 1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
