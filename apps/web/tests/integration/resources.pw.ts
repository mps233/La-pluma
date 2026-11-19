import { expect, test } from '@playwright/test'
import {
  createScenarioState,
  expectScenarioHealthy,
  gotoScenario,
  installIntegrationScenario,
  navigateTo,
  requestsFor,
} from './harness'

test('配置已保存而定时注册失败时，跨页保留草稿并只在显式重试后确认同步', async ({ page }) => {
  const state = createScenarioState()
  state.runState = 'succeeded'
  await installIntegrationScenario(page, state)
  await gotoScenario(page, 'automation')
  await expect(page.getByRole('button', { name: '新增时间', exact: true })).toBeEnabled()

  state.scheduleFailuresRemaining = 1
  await page.getByRole('button', { name: '新增时间', exact: true }).click()
  const syncErrorToast = page.locator('[data-sonner-toast]').filter({ hasText: '定时注册暂未确认，请重试' })
  await expect(syncErrorToast).toBeVisible()
  expect(state.automationSaveCalls).toHaveLength(1)
  expect(state.scheduleCalls).toHaveLength(1)
  const savedDraft = structuredClone(state.automationConfig)
  await expect(page.getByLabel('已设置 3 个执行时间')).toBeVisible()

  await navigateTo(page, 'dashboard')
  await navigateTo(page, 'automation')
  await expect(syncErrorToast).toBeVisible()
  await expect(page.getByLabel('已设置 3 个执行时间')).toBeVisible()
  expect(state.scheduleCalls).toHaveLength(1)
  await syncErrorToast.getByRole('button', { name: '重新同步', exact: true }).click()
  await expect(syncErrorToast).toHaveCount(0)
  expect(state.automationSaveCalls).toHaveLength(2)
  expect(state.scheduleCalls).toHaveLength(2)
  expect(state.automationConfig).toEqual(savedDraft)
  expect(state.submissions).toHaveLength(0)
  await expectScenarioHealthy(page)
})

test('识别完成使隐藏养成与总览失效，应用计划后自动化读取同一服务端配置', async ({ page }) => {
  const state = createScenarioState()
  state.runState = 'succeeded'
  await installIntegrationScenario(page, state)

  // 先挂载各个 Activity，随后隐藏：验证恢复时消费失效，而非重建一份资源。
  await gotoScenario(page, 'dashboard')
  await expect(page.locator('[data-dashboard-summary="training"] [data-dashboard-summary-number]')).toHaveText('2')
  await navigateTo(page, 'automation')
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled()
  await navigateTo(page, 'training')
  await expect(page.getByRole('button', { name: '预览刷图计划', exact: true })).toBeEnabled()
  const initialQueueReads = requestsFor(state, '/agent/training/queue', 'GET').length
  const initialDashboardReads = requestsFor(state, '/agent/drops/today', 'GET').length
  await navigateTo(page, 'statistics')
  await expect(page.getByRole('button', { name: '立即执行', exact: true })).toBeEnabled()

  // 解析成功后权威队列变化，识别命令只能提交一次。
  state.trainingQueue = { ...state.trainingQueue, queue: (state.trainingQueue.queue as unknown[]).slice(0, 1) }
  await page.getByRole('button', { name: '立即执行', exact: true }).click()
  await expect.poll(() => requestsFor(state, '/agent/actions/operbox-recognition', 'POST').length).toBe(1)
  await expect(page.getByRole('button', { name: '立即执行', exact: true })).toBeEnabled()
  expect(state.submissions).toHaveLength(1)

  await navigateTo(page, 'training')
  await expect(page.getByRole('heading', { name: '养成队列 1', exact: true })).toBeVisible()
  await expect.poll(() => requestsFor(state, '/agent/training/queue', 'GET').length).toBeGreaterThan(initialQueueReads)
  await page.getByRole('button', { name: '预览刷图计划', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用到自动任务', exact: true })).toBeEnabled()
  await expect(page.locator('[data-training-stage-row]')).toContainText('CE-6')
  await page.getByRole('button', { name: '应用到自动任务', exact: true }).click()
  await expect.poll(() => state.applyCalls.length).toBe(1)
  await expect(page.getByText('已同步到自动任务', { exact: true })).toBeVisible()

  await navigateTo(page, 'automation')
  await page.locator('button[aria-controls="automation-task-editor"]').filter({ hasText: '理智作战' }).click()
  await expect(page.locator('[data-automation-stage-kind="smart"] [data-automation-stage-name]')).toHaveValue('CE-6')
  expect(state.automationSaveCalls).toHaveLength(0)
  const manualFlow = state.automationConfig.taskFlow as Array<{ commandId: string; params: { stages?: unknown[] } }>
  expect(manualFlow.find(task => task.commandId === 'fight')?.params.stages).toEqual([
    { stage: '1-7', times: '1' },
    { stage: 'CE-6', times: '3', smart: true, trainingOperators: ['艾雅法拉'] },
  ])

  await navigateTo(page, 'dashboard')
  await expect(page.locator('[data-dashboard-summary="training"] [data-dashboard-summary-number]')).toHaveText('1')
  await expect.poll(() => requestsFor(state, '/agent/drops/today', 'GET').length).toBeGreaterThan(initialDashboardReads)
  expect(state.submissions).toHaveLength(1)
  expect(state.applyCalls).toHaveLength(1)
  await expectScenarioHealthy(page)
})
