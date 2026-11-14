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

    test(`form controls ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the form control group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const controls = page.locator('[data-region="gallery-form-controls"]')
      await controls.scrollIntoViewIfNeeded()
      await expect(controls).toBeVisible()

      const mixed = page.getByRole('checkbox', { name: '部分选择（混合态）', exact: true })
      const checked = page.getByRole('checkbox', { name: '自动补位', exact: true })
      await expect(mixed).toHaveAttribute('aria-checked', 'mixed')
      const [mixedStyle, checkedStyle] = await Promise.all([
        mixed.evaluate(element => {
          const style = getComputedStyle(element)
          return { borderColor: style.borderColor, backgroundColor: style.backgroundColor }
        }),
        checked.evaluate(element => {
          const style = getComputedStyle(element)
          return { borderColor: style.borderColor, backgroundColor: style.backgroundColor }
        }),
      ])
      expect(mixedStyle).toEqual(checkedStyle)

      const errorInput = page.getByRole('textbox', { name: '作业 URI', exact: true })
      await expect(errorInput).toHaveAttribute('aria-invalid', 'true')
      await expect(errorInput).toHaveAccessibleDescription('未找到匹配的作业')

      await expect(controls).toHaveScreenshot(`theme-gallery-form-controls-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`select popup ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the select popup state is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const trigger = page.locator('#gallery-select-source')
      await trigger.evaluate(element => {
        element.scrollIntoView({ block: 'center' })
      })
      await trigger.click()
      const listbox = page.getByRole('listbox')
      await expect(listbox).toBeVisible()
      const disabledOption = page.getByRole('option', { name: '离线镜像（禁用）', exact: true })
      await expect(disabledOption).toBeVisible()
      await expect(disabledOption).toHaveAttribute('aria-disabled', 'true')
      await expect(listbox).toHaveScreenshot(`theme-gallery-select-popup-${theme}.png`, {
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
