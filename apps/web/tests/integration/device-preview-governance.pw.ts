import { expect, test, type Locator, type Page } from '@playwright/test'
import { createScenarioState, expectScenarioHealthy, installIntegrationScenario } from './harness'

const MIN_TARGET_PX = 44
const COMPACT_SEGMENT_ITEM_HEIGHT_PX = 28

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, `${label} 应可见`).not.toBeNull()
  expect(box!.width, `${label} 宽度`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  expect(box!.height, `${label} 高度`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
}

async function expectCompactSegment(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox()
  expect(box, `${label} 应可见`).not.toBeNull()
  expect(box!.width, `${label} 宽度`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  expect(box!.height, `${label} 高度`).toBeGreaterThanOrEqual(COMPACT_SEGMENT_ITEM_HEIGHT_PX - 1)
  expect(box!.height, `${label} 高度`).toBeLessThanOrEqual(COMPACT_SEGMENT_ITEM_HEIGHT_PX + 1)
}

async function openPreviewSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '打开预览设置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`预览共享面在 ${viewport.width}px 下保持触达目标与紧凑模式分段且无横向溢出`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const scenario = createScenarioState()
    scenario.runState = 'succeeded'
    await installIntegrationScenario(page, scenario)
    await page.route('**/api/agent/screen/screenshot', route => route.fulfill({
      json: { success: false, error: { code: 'SCREENSHOT_FAILED', message: '截图失败' } },
    }))
    await page.goto('/app/logs')

    const preview = page.locator('[data-region="monitor"]:visible')
    await expect(preview).toBeVisible()

    for (const name of ['关闭', '快照', '实时']) {
      await expectCompactSegment(preview.getByRole('button', { name, exact: true }), `模式 ${name}`)
    }
    for (const name of ['返回', 'Home', '后台任务', '全屏', '打开预览设置']) {
      await expectTouchTarget(preview.getByRole('button', { name, exact: true }), `工具栏 ${name}`)
    }

    const dialog = await openPreviewSettings(page)

    await expectTouchTarget(dialog.getByRole('button', { name: '关闭对话框', exact: true }), '模态窗关闭')
    await expectTouchTarget(dialog.getByRole('button', { name: '重连预览', exact: true }), '重连预览')
    for (const name of ['启动服务', '连接 Agent', '断开', '重装组件']) {
      await expectTouchTarget(dialog.getByRole('button', { name, exact: true }), `服务 ${name}`)
    }
    for (const name of ['流畅画质', '高清画质', '超清画质', '自定义画质']) {
      await expectTouchTarget(dialog.getByRole('button', { name, exact: true }), `预设 ${name}`)
    }
    for (const fps of [10, 15, 30, 45, 60, 90, 120, 240]) {
      await expectTouchTarget(dialog.getByRole('button', { name: `${fps} FPS`, exact: true }), `帧率 ${fps}`)
    }
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0)

    await dialog.getByRole('button', { name: '高清画质', exact: true }).click()
    const qualityToast = page.locator('[data-sonner-toast]', { hasText: '画质已修改' })
    await expect(qualityToast).toBeVisible()
    await expect(qualityToast).toContainText(/下次连接实时预览时生效|重连后生效/)
    await qualityToast.getByRole('button', { name: '关闭通知', exact: true }).click()
    await expect(qualityToast).toHaveCount(0)

    const installButton = dialog.getByRole('button', { name: '重装组件', exact: true })
    await installButton.hover()
    const tooltip = page.locator('[data-slot="tooltip-content"]')
    await expect(tooltip).toBeVisible()
    const installBox = await installButton.boundingBox()
    const tooltipBox = await tooltip.boundingBox()
    expect(installBox, '重装组件应可见').not.toBeNull()
    expect(tooltipBox, '重装组件提示应可见').not.toBeNull()
    expect(
      Math.abs((tooltipBox!.x + tooltipBox!.width / 2) - (installBox!.x + installBox!.width / 2)),
      '提示应与触发按钮水平居中',
    ).toBeLessThanOrEqual(24)
    expect(tooltipBox!.y, '提示不应落在视口左上角').toBeGreaterThan(0)
    expect(tooltipBox!.y + tooltipBox!.height, '提示应位于触发按钮上方').toBeLessThanOrEqual(installBox!.y + 8)
    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()

    expect(await preview.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await preview.getByRole('button', { name: '快照', exact: true }).click()
    const retry = preview.getByRole('button', { name: '重试', exact: true })
    await expect(retry).toBeVisible()
    await expectTouchTarget(retry, '错误重试')

    await expectScenarioHealthy(page)
  })
}
