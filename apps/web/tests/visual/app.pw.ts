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
})
