import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  THEMES,
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

const TOOLTIP_LONG_COPY = '使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限，留空表示不限制局数。'

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

    test(`card surfaces ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the card surface group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const surfaces = page.locator('[data-region="gallery-card-surfaces"]')
      await surfaces.scrollIntoViewIfNeeded()
      await expect(surfaces).toBeVisible()
      await expect(surfaces.locator('[data-slot="card"]').first()).toBeVisible()
      await expect(surfaces.locator('[data-slot="skeleton"]').first()).toBeVisible()

      await expect(surfaces).toHaveScreenshot(`theme-gallery-card-surfaces-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`buttons ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the button group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const buttons = page.locator('[data-region="gallery-buttons"]')
      await buttons.scrollIntoViewIfNeeded()
      await expect(buttons).toBeVisible()

      for (const name of ['保存草稿', '查看日志', '导出数据', '忽略', '停止执行', '查看文档']) {
        await expect(buttons.getByRole('button', { name, exact: true }).first()).toBeVisible()
      }
      for (const name of ['超小', '小尺寸', '中尺寸', '大尺寸']) {
        await expect(buttons.getByRole('button', { name, exact: true })).toBeVisible()
      }

      const loading = buttons.getByRole('button', { name: '执行中', exact: true })
      await expect(loading).toBeVisible()
      await expect(loading.locator('svg')).toBeVisible()
      await expect(buttons.getByRole('button', { name: '同步中', exact: true })).toBeDisabled()
      await expect(buttons.getByRole('button', { name: '不可用', exact: true })).toBeDisabled()
      await expect(buttons.getByRole('button', { name: '已停止', exact: true })).toBeDisabled()

      for (const name of ['图标 超小', '图标 小尺寸', '图标 中尺寸', '图标 大尺寸', '刷新', '删除']) {
        await expect(buttons.getByRole('button', { name, exact: true })).toBeVisible()
      }

      await expect(buttons).toHaveScreenshot(`theme-gallery-buttons-${theme}.png`, {
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

    test(`dialog standard ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the dialog group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-dialogs"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '打开标准对话框', exact: true }).click()
      const dialog = page.locator('#gallery-dialog-standard')
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveScreenshot(`theme-gallery-dialog-standard-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`dialog large ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the dialog group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-dialogs"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '打开大尺寸对话框', exact: true }).click()
      const dialog = page.locator('#gallery-dialog-large')
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveScreenshot(`theme-gallery-dialog-large-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`alert dialog ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the dialog group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-dialogs"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '打开确认对话框', exact: true }).click()
      const dialog = page.locator('#gallery-alert-dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveScreenshot(`theme-gallery-alert-dialog-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`sheet right ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the sheet group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-dialogs"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '打开右侧抽屉', exact: true }).click()
      const sheet = page.locator('#gallery-sheet-right')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveScreenshot(`theme-gallery-sheet-right-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`sheet bottom ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'mobile', 'the bottom sheet is captured on the mobile projection')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-dialogs"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '打开底部抽屉', exact: true }).click()
      const sheet = page.locator('#gallery-sheet-bottom')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveScreenshot(`theme-gallery-sheet-bottom-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`tooltip open ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the tooltip group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-tooltips"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      const trigger = page.getByRole('button', { name: '上方长文案说明', exact: true })
      await trigger.hover()

      const tooltip = page.getByRole('tooltip').filter({ hasText: TOOLTIP_LONG_COPY })
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toHaveText(TOOLTIP_LONG_COPY)

      const groupBox = await group.boundingBox()
      const tooltipBox = await tooltip.boundingBox()
      expect(groupBox).not.toBeNull()
      expect(tooltipBox).not.toBeNull()
      expect(tooltipBox!.x).toBeGreaterThanOrEqual(groupBox!.x - 1)
      expect(tooltipBox!.y).toBeGreaterThanOrEqual(groupBox!.y - 1)
      expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 1)
      expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(groupBox!.y + groupBox!.height + 1)

      await expect(group).toHaveScreenshot(`theme-gallery-tooltips-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`dropdown menu open ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the overlay group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-overlays"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.locator('#gallery-dropdown-trigger').click()
      const menu = page.locator('[data-slot="dropdown-menu-content"]')
      await expect(menu).toBeVisible()
      await expect(page.getByRole('menu', { name: '筛选排序' })).toBeVisible()

      await expect(menu).toHaveScreenshot(`theme-gallery-dropdown-menu-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`toast undo ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the overlay group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-overlays"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '显示可撤销提示', exact: true }).click()
      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toBeVisible()
      await expect(toast).toContainText('已移除 阿米娅')

      await expect(toast).toHaveScreenshot(`theme-gallery-toast-undo-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`toast pending ${theme}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the overlay group is captured once per theme')

      const environment = await installDeterministicEnvironment(page)

      await page.goto('/dev/theme-gallery')
      await waitForPageReady(page, 'gallery')

      const group = page.locator('[data-region="gallery-overlays"]')
      await group.scrollIntoViewIfNeeded()
      await expect(group).toBeVisible()

      await page.getByRole('button', { name: '显示恢复中提示', exact: true }).click()
      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toBeVisible()
      await expect(toast).toContainText('恢复中')

      await expect(toast).toHaveScreenshot(`theme-gallery-toast-pending-${theme}.png`, {
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
