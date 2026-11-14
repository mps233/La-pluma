import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  THEMES,
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

/**
 * 主题画廊是 shadcn 迁移的护栏画布：零 API 依赖（布局 chrome 的干员语录走既有
 * fixture），整页截图只关心主题种子与确定性环境；迁移批次在同一画布上比对全局
 * 表面。chrome 表面（sidebar、tab bar、更多弹层）按 data-region / data-slot 锚点
 * 定位单独截图，桌面与移动投影各取所需。
 */
for (const theme of THEMES) {
  test.describe(`theme gallery: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      recordBrowserErrors(page)
      await page.addInitScript(themeSeedScript(theme))
    })

    test(`full page ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'theme gallery is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      await expect(page).toHaveScreenshot(`theme-gallery-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`sidebar ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the workspace sidebar is desktop-only')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const sidebar = page.locator('[data-region="sidebar"]')
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveScreenshot(`theme-gallery-sidebar-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`mobile tab bar ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'mobile', 'the tab bar is the mobile chrome surface')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const tabbar = page.locator('[data-region="tabbar"]')
      await expect(tabbar).toBeVisible()
      await expect(tabbar).toHaveScreenshot(`theme-gallery-tabbar-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`mobile overflow sheet ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'mobile', 'the overflow sheet is the mobile chrome surface')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      await page.getByRole('button', { name: '更多页面' }).click()
      const sheet = page.locator('[data-slot="sheet-content"]')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveScreenshot(`theme-gallery-more-sheet-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })
  })
}
