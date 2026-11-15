import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const RECRUIT_HINT = '活动期间领取限定池赠送的每日免费单抽；没有免费次数时不抽取'
const ANNIVERSARY_HINT = '领取周年活动赠送的月卡奖励'
const SIGN_IN_HINT = '领取限时签到活动的每日奖励（仅支持常见横向版型）'

const isMobileProject = () => test.info().project.name === 'mobile'

const revealHint = async (hint: Locator) => {
  if (isMobileProject()) await hint.tap()
  else await hint.hover()
}

const dismissHint = async (page: Page) => {
  if (isMobileProject()) await page.touchscreen.tap(4, 4)
  else await page.mouse.move(4, 4)
}

const selectAwardTask = async (page: Page) => {
  await page.goto('/app/automation')
  await waitForPageReady(page, 'automation')
  const task = page.locator('button[aria-controls="automation-task-editor"]').filter({ hasText: '领取奖励' })
  if (isMobileProject()) await task.tap()
  else await task.click()
  await page.getByRole('button', { name: '限定池免费单抽说明', exact: true }).waitFor()
}

test.describe('automation award field hints', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('turns the award helper paragraphs into label tooltips', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await selectAwardTask(page)

    const recruitHint = page.getByRole('button', { name: '限定池免费单抽说明', exact: true })
    const anniversaryHint = page.getByRole('button', { name: '周年赠送月卡说明', exact: true })
    const signInHint = page.getByRole('button', { name: '限时签到活动奖励说明', exact: true })
    await expect(recruitHint).toBeVisible()
    await expect(anniversaryHint).toBeVisible()
    await expect(signInHint).toBeVisible()

    const tooltipOf = (hint: string) => page.getByRole('tooltip').filter({ hasText: hint })
    const recruitTooltip = tooltipOf(RECRUIT_HINT)
    const anniversaryTooltip = tooltipOf(ANNIVERSARY_HINT)
    const signInTooltip = tooltipOf(SIGN_IN_HINT)

    // 说明文字只在打开提示层时挂载，不再有常驻段落。
    await expect(recruitTooltip).toBeHidden()
    await expect(anniversaryTooltip).toBeHidden()
    await expect(signInTooltip).toBeHidden()
    await expect(page.getByText(RECRUIT_HINT, { exact: true })).toHaveCount(0)
    await expect(page.getByText(ANNIVERSARY_HINT, { exact: true })).toHaveCount(0)
    await expect(page.getByText(SIGN_IN_HINT, { exact: true })).toHaveCount(0)

    await revealHint(recruitHint)
    await expect(recruitTooltip).toBeVisible()
    await expect(recruitTooltip).toHaveText(RECRUIT_HINT)
    await dismissHint(page)
    await expect(recruitTooltip).toBeHidden()

    await revealHint(anniversaryHint)
    await expect(anniversaryTooltip).toBeVisible()
    await expect(anniversaryTooltip).toHaveText(ANNIVERSARY_HINT)
    await dismissHint(page)
    await expect(anniversaryTooltip).toBeHidden()

    await signInHint.focus()
    await expect(signInHint).toBeFocused()
    await expect(signInTooltip).toBeVisible()
    await expect(signInTooltip).toHaveText(SIGN_IN_HINT)
    await page.keyboard.press('Escape')
    await expect(signInTooltip).toBeHidden()

    // 点击提示图标只展开说明，不会切换同一行的领取开关。
    const recruitSwitch = page.locator('#automation-award-visual-3-recruit')
    await expect(recruitSwitch).toBeChecked()
    await recruitHint.click()
    await expect(recruitTooltip).toBeVisible()
    await expect(recruitSwitch).toBeChecked()
    await page.keyboard.press('Escape')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps every award hint icon next to its option label', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await selectAwardTask(page)

    const measure = async (label: Locator, hint: Locator) => {
      const labelBox = await label.boundingBox()
      const hintBox = await hint.boundingBox()
      expect(labelBox).not.toBeNull()
      expect(hintBox).not.toBeNull()
      return {
        gap: hintBox!.x - (labelBox!.x + labelBox!.width),
        centerOffset: hintBox!.y + hintBox!.height / 2 - (labelBox!.y + labelBox!.height / 2),
      }
    }

    const fields = [
      { key: 'recruit', hint: '限定池免费单抽说明' },
      { key: 'specialaccess', hint: '周年赠送月卡说明' },
      { key: 'signinevent', hint: '限时签到活动奖励说明' },
    ]

    for (const field of fields) {
      const { gap, centerOffset } = await measure(
        page.locator(`label:has(#automation-award-visual-3-${field.key})`),
        page.getByRole('button', { name: field.hint, exact: true }),
      )
      // 图标紧跟在标签文字之后，中间只留 inline 的小间距，而不是被推到行尾。
      expect(gap).toBeGreaterThan(0)
      expect(Math.abs(gap - 4)).toBeLessThanOrEqual(2)
      expect(Math.abs(centerOffset)).toBeLessThanOrEqual(2)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
