import { expect, test, type Locator } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok } from './fixtures'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const scheduleSaveFixture = { path: '/agent/schedules', method: 'POST', payload: ok({}) }

const infrastFixtures = [
  {
    path: '/agent/config/user/automation-tasks',
    payload: ok({
      taskFlow: [
        {
          id: 'startup-select-1',
          commandId: 'startup',
          name: '启动游戏',
          description: '启动游戏客户端',
          enabled: true,
          params: { clientType: 'Official', accountName: '' },
        },
        {
          id: 'infrast-select-1',
          commandId: 'infrast',
          name: '基建换班',
          description: '自动基建换班收菜',
          taskType: 'Infrast',
          enabled: true,
          params: {
            mode: '10000',
            facility: ['Mfg', 'Recycle', 'AssistantChange'],
            threshold: '0.3',
            replenish: false,
            filename: '',
            plan_index: 0,
            continue_training: false,
            dorm_notstationed_enabled: false,
            dorm_trust_enabled: false,
            reception_message_board: true,
            reception_clue_exchange: true,
            reception_send_clue: true,
          },
        },
      ],
      schedule: { enabled: false, entries: [] },
    }),
  },
  { path: '/agent/infrast-schedules', payload: ok({ directory: '/opt/maa/config/infrast', schedules: [] }) },
  scheduleSaveFixture,
  ...apiFixtures,
]

async function expectPopupCoversItsCenter(popup: Locator) {
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  const hitInside = await popup.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y)
    return Boolean(hit && (hit === element || element.contains(hit)))
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
  expect(hitInside, '弹层中心应命中弹层自身而不是被弹层遮罩挡住').toBe(true)
}

test.describe('form select overlays inside modals', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('opens the schedule plan select above the infrast editor modal', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: infrastFixtures })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    await page.locator('button[aria-controls="automation-task-editor"]').filter({ hasText: '基建换班' }).click()
    await page.getByRole('button', { name: '编辑排班', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: '自定义基建排班' })
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('textbox', { name: '排班文件', exact: true }).fill('schedules/visual.json')
    await dialog.getByRole('button', { name: '新建排班', exact: true }).click()
    await dialog.getByRole('button', { name: '添加方案', exact: true }).click()

    const trigger = dialog.getByRole('combobox', { name: '方案', exact: true })
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await expectPopupCoversItsCenter(listbox)

    await page.getByRole('option', { name: '方案 2', exact: true }).click()
    await expect(trigger).toContainText('方案 2')
    await expect(listbox).toBeHidden()

    await trigger.click()
    await expect(listbox).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('opens the operator profession select above the picker modal', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, {
      fixtures: [...apiFixtures, scheduleSaveFixture],
    })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    await page.getByRole('button', { name: '添加任务' }).click()
    await page.getByRole('menuitem', { name: '游戏内培养' }).click()
    await page.getByRole('button', { name: '添加培养计划' }).click()
    await page.getByRole('button', { name: '选择干员' }).click()

    const dialog = page.getByRole('dialog', { name: '选择干员' })
    await dialog.waitFor({ state: 'visible' })
    const trigger = dialog.getByRole('combobox', { name: '职业筛选', exact: true })
    await trigger.click()

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await expectPopupCoversItsCenter(listbox)

    await page.getByRole('option', { name: '术师', exact: true }).click()
    await expect(trigger).toContainText('术师')
    await expect(dialog.getByRole('button', { name: '选择艾雅法拉', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '选择陈', exact: true })).toHaveCount(0)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
