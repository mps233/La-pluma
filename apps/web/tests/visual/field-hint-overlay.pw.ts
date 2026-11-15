import { expect, test, type Locator } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const COMBAT_FORMATION_HINT = '“自动决定”会在队列执行时启用自动编队，单作业沿用 Maa CLI 的默认设置。'
const ROGUELIKE_DIFFICULTY_HINT = '不切换时沿用游戏内当前难度；指定未解锁的难度会被降到已解锁上限。'

const pointInsideTooltipOver = async (
  tooltip: Locator,
  selector: string,
  text?: string,
  requireUnpressed = false,
) => {
  return tooltip.evaluate((element, { targetSelector, targetText, unpressedOnly }) => {
    const rect = element.getBoundingClientRect()
    for (let y = rect.top + 4; y < rect.bottom - 4; y += 6) {
      for (let x = rect.left + 4; x < rect.right - 4; x += 6) {
        const hit = document.elementFromPoint(x, y)
        const target = hit?.closest(targetSelector)
        if (!target) continue
        if (targetText && !target.textContent?.includes(targetText)) continue
        if (unpressedOnly && target.getAttribute('aria-pressed') !== 'false') continue
        return { x, y, label: target.textContent?.trim() ?? '' }
      }
    }
    return null
  }, { targetSelector: selector, targetText: text, unpressedOnly: requireUnpressed })
}

const expectTooltipDoesNotCatchPoint = async (tooltip: Locator, point: { x: number; y: number }) => {
  expect(await tooltip.evaluate((element, target) => {
    const hit = document.elementFromPoint(target.x, target.y)
    return hit !== null && !element.contains(hit)
  }, point)).toBe(true)
}

const isMobileProject = () => test.info().project.name === 'mobile'

test.describe('field hint overlay behavior', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('combat hint closes when moving into its covered control and lets clicks through', async ({ page }) => {
    const mobile = isMobileProject()
    const environment = await installDeterministicEnvironment(page, { nativeClock: true })
    await page.goto('/app/combat')
    await waitForPageReady(page, 'combat')

    const hint = page.getByRole('button', { name: '编队说明', exact: true })
    const tooltip = page.getByRole('tooltip').filter({ hasText: COMBAT_FORMATION_HINT })
    await expect(hint).toBeVisible()

    const autoFormation = page.getByRole('button', { name: '自动编队', exact: true })
    if (mobile) await autoFormation.tap()
    else await autoFormation.click()
    await expect(autoFormation).toHaveAttribute('aria-pressed', 'true')

    if (mobile) await hint.tap()
    else await hint.hover()
    await page.waitForTimeout(600)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveAttribute('data-open', '')
    const describedBy = await hint.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveText(COMBAT_FORMATION_HINT)
    const tooltipBox = await tooltip.boundingBox()
    expect(tooltipBox).not.toBeNull()
    await expectTooltipDoesNotCatchPoint(tooltip, {
      x: tooltipBox!.x + tooltipBox!.width / 2,
      y: tooltipBox!.y + tooltipBox!.height / 2,
    })

    const point = await pointInsideTooltipOver(tooltip, 'button', undefined, true)
    expect(point, 'tooltip should cover an inactive formation option').not.toBeNull()
    await expectTooltipDoesNotCatchPoint(tooltip, point!)

    const coveredOption = page.getByRole('button', { name: point!.label, exact: true })
    if (mobile) {
      await page.touchscreen.tap(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
    } else {
      await page.mouse.move(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
      await hint.focus()
      await expect(tooltip).toBeVisible()
      await page.mouse.click(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
    }
    await expect(coveredOption).toHaveAttribute('aria-pressed', 'true')

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('roguelike hint closes when moving into its covered select and lets clicks through', async ({ page }) => {
    const mobile = isMobileProject()
    const environment = await installDeterministicEnvironment(page, { nativeClock: true })
    await page.goto('/app/roguelike')
    await waitForPageReady(page, 'roguelike')

    if (mobile) {
      await page.locator('#roguelike-roguelike-difficulty').tap()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.getByRole('option', { name: '不切换（沿用游戏内难度）', exact: true }).tap()
    }

    const hint = page.getByRole('button', { name: '难度说明', exact: true })
    const tooltip = page.getByRole('tooltip').filter({ hasText: ROGUELIKE_DIFFICULTY_HINT })
    await expect(hint).toBeVisible()

    if (mobile) await hint.tap()
    else await hint.hover()
    await page.waitForTimeout(600)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveAttribute('data-open', '')
    const describedBy = await hint.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveText(ROGUELIKE_DIFFICULTY_HINT)
    const tooltipBox = await tooltip.boundingBox()
    expect(tooltipBox).not.toBeNull()
    await expectTooltipDoesNotCatchPoint(tooltip, {
      x: tooltipBox!.x + tooltipBox!.width / 2,
      y: tooltipBox!.y + tooltipBox!.height / 2,
    })

    const point = await pointInsideTooltipOver(tooltip, '[role="combobox"]', '不切换（沿用游戏内难度）')
    expect(point, 'tooltip should cover the difficulty select').not.toBeNull()
    await expectTooltipDoesNotCatchPoint(tooltip, point!)

    if (mobile) {
      await page.touchscreen.tap(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
    } else {
      await page.mouse.move(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
      await hint.focus()
      await expect(tooltip).toBeVisible()
      await page.mouse.click(point!.x, point!.y)
      await expect(tooltip).toBeHidden()
    }
    await expect(page.getByRole('listbox')).toBeVisible()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
