import type { Page, Route } from '@playwright/test'

/** 固定"现在"：2026-10-24 04:00:00 (UTC+8)，即明日方舟每日重置时刻。 */
export const FIXED_NOW = new Date('2026-10-24T04:00:00+08:00')

export const ok = (data: unknown) => ({ success: true, data })

export interface ApiFixture {
  /** 相对 API_BASE_URL 的路径（不含 /api 前缀），支持 `:id` 段匹配。 */
  path: string
  method?: string
  payload: unknown
}

export const apiFixtures: ApiFixture[] = [
  { path: '/agent/tasks/status', payload: ok({ isRunning: false }) },
  {
    path: '/agent/runs/current',
    payload: ok({
      isRunning: false,
      taskName: null,
      startTime: null,
      taskType: null,
      stopRequested: false,
      schedule: {
        isRunning: false,
        scheduleId: null,
        runId: null,
        currentStep: null,
        totalSteps: 0,
        currentTask: null,
        shouldStop: false,
        message: '空闲中',
        // 服务端快照的 schedule 是完整流程状态；空闲时保留最近一次结果供页面展示。
        lastResult: { successCount: 6, failedCount: 0, skippedCount: 1, durationMs: 952000 },
      },
      recentLogs: [],
      run: null,
      activeRuns: [],
      lastRun: null,
      occupancy: {
        state: 'idle',
        runId: null,
        runState: null,
        sources: [],
        lease: { state: 'free', owner: null },
        task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
        schedule: { isRunning: false, scheduleId: null, runId: null, currentStep: null, totalSteps: 0, currentTask: null, shouldStop: false },
      },
    }),
  },
  {
    path: '/operator-quotes/daily',
    payload: ok({ operatorId: 'char_002_amiya', operator: '阿米娅', quote: '今天也请多指教' }),
  },
  {
    path: '/agent/activity',
    payload: ok({
      status: 'active',
      clientType: 'Official',
      available: true,
      message: '当前活动: 春厦限定纪行',
      code: 'BP01',
      name: '春厦限定纪行',
      source: 'maa',
      startTime: null,
      endTime: null,
      stages: [],
      lastSuccessAt: 1_760_000_000_000,
      dataUpdatedAt: 1_760_000_000_000,
      failure: null,
      completion: { known: true, complete: false, completedStages: ['AS-1', 'AS-2'], totalStages: 8, source: 'local-activity-progress' },
    }),
  },
  {
    path: '/agent/schedules/execution',
    payload: ok({
      isRunning: false,
      message: '空闲中',
      lastTaskName: '晨间日常',
      lastResult: { successCount: 6, failedCount: 0, skippedCount: 1, durationMs: 952000 },
    }),
  },
  { path: '/agent/webrtc/status', payload: ok({ installed: true, built: true, serverRunning: false, agentRunning: false }) },
  {
    path: '/agent/config/resource-source',
    payload: ok({
      autoUpdate: true,
      warnOnUpdateFailure: true,
      source: 'git',
      git: { backend: 'git', url: 'https://github.com/MaaAssistantArknights/MaaResource.git', branch: 'main' },
      mirrorchyan: { cdkKind: 'none', checkInterval: 600 },
    }),
  },

  {
    path: '/agent/drops/today',
    payload: ok([
      { stage: '1-7', stageName: '主线 1-7', drops: [{ name: '固源岩', count: 5 }, { name: '装置', count: 2 }] },
      { stage: 'CE-6', stageName: '龙门币补给 CE-6', drops: [{ name: '龙门币', count: 10000 }] },
      { stage: 'LS-6', stageName: '经验补给 LS-6', drops: [{ name: '作战记录', count: 8 }] },
    ]),
  },
  {
    path: '/agent/stages/open-today',
    payload: ok({
      open: [
        { stage: 'CE-6', name: '龙门币补给' },
        { stage: 'AP-5', name: '采购凭证' },
        { stage: 'SK-5', name: '碳素元件' },
        { stage: 'PR-B-2', name: '芯片搜索' },
      ],
      closed: [
        { stage: 'LS-6', name: '经验补给' },
        { stage: 'CA-5', name: '技能概要' },
      ],
    }),
  },
  {
    path: '/agent/device-stats',
    payload: ok({
      cpuPct: 23.4,
      load1m: 0.82,
      memPct: 61.2,
      memUsed: '9.8 GiB',
      memTotal: '16.0 GiB',
      diskPct: 47.3,
      diskUsed: '215.4 GiB',
      diskTotal: '512.0 GiB',
      temp: 52.5,
    }),
  },

  {
    path: '/agent/config/user/automation-tasks',
    payload: ok({
      taskFlow: [
        {
          id: 'startup-visual-1',
          commandId: 'startup',
          name: '启动游戏',
          description: '启动游戏客户端',
          defaultParams: { clientType: 'Official' },
          params: { clientType: 'Official', address: '127.0.0.1:5555' },
          enabled: true,
        },
        {
          id: 'fight-visual-2',
          commandId: 'fight',
          name: '理智作战',
          description: '按配置刷取关卡',
          defaultParams: { stage: '1-7' },
          params: { stages: [{ stage: '1-7', times: '10' }], medicine: 0, stone: 0 },
          enabled: true,
        },
        {
          id: 'award-visual-3',
          commandId: 'award',
          name: '领取奖励',
          description: '领取每日奖励',
          defaultParams: { award: true },
          params: { award: true, mail: true, recruit: true },
          enabled: true,
        },
      ],
      schedule: {
        enabled: true,
        entries: [
          { time: '04:00', enabled: true },
          { time: '12:00', enabled: true },
        ],
      },
    }),
  },
  {
    path: '/agent/config/user/combat-tasks',
    payload: ok({
      taskInputs: { fight: '1-7', copilot: 'maa://10086' },
      advancedParams: {},
      autoFormation: {},
      copilotSetExecutionMode: 'cli',
      copilotSetSelections: {},
    }),
  },
  // 战斗工作区挂载即预取默认作业搜索，空结果对应默认关闭的发现弹窗。
  {
    path: '/agent/copilot/search',
    payload: ok({ copilots: [], total: 0, page: 1, hasNext: false }),
  },
  {
    path: '/agent/config/user/roguelike-tasks',
    payload: ok({
      taskInputs: { roguelike: 'Mizuki' },
      advancedParams: {},
    }),
  },
  { path: '/agent/config/user/training-queue', payload: ok({ queue: [] }) },
  { path: '/agent/config/user/auto-update', payload: ok({ enabled: true, time: '04:30', updateCore: true, updateCli: false }) },
  // 各任务页水合后会触发一次自动保存（autoSave），统一回成功包。
  { path: '/agent/config/user/:type', method: 'POST', payload: ok({}) },
  {
    path: '/agent/notifications/config',
    payload: ok({
      enabled: true,
      channels: { telegram: { enabled: true, botToken: '6123456789:AAVisualBaseline', chatId: '-1002345678901' } },
    }),
  },

  {
    path: '/agent/training/queue',
    payload: ok({
      queue: [
        {
          operatorId: 'char_180_amgoat',
          operator: { name: '艾雅法拉', rarity: 6, profession: 'CASTER' },
          currentElite: 1,
          targetElite: 2,
          materials: [
            { id: '30063', name: '聚合剂', iconId: '30063', count: 4, have: 2, needed: 4, stillNeeded: 2 },
            { id: '30073', name: '晶体电路', iconId: '30073', count: 8, have: 8, needed: 8, stillNeeded: 0 },
          ],
          lmd: { needed: 120000, have: 90000, stillNeeded: 30000 },
          progress: 0.35,
          settings: { useMedicine: 0, useStone: 0, autoSwitch: true, notifyOnComplete: true },
        },
        {
          operatorId: 'char_202_demkni',
          operator: { name: '塞雷娅', rarity: 6, profession: 'TANK' },
          currentElite: 0,
          targetElite: 2,
          materials: [
            { id: '30013', name: '固源岩组', iconId: '30013', count: 15, have: 9, needed: 15, stillNeeded: 6 },
          ],
          lmd: { needed: 180000, have: 40000, stillNeeded: 140000 },
          progress: 0.12,
          settings: { useMedicine: 0, useStone: 0, autoSwitch: false, notifyOnComplete: false },
        },
      ],
      settings: { useMedicine: 0, useStone: 0, autoSwitch: true, notifyOnComplete: true },
      revision: 'visual-baseline-1',
      flowSync: false,
    }),
  },
  {
    path: '/agent/training/operators',
    payload: ok({
      operators: [
        { id: 'char_180_amgoat', name: '艾雅法拉', rarity: 6, profession: 'CASTER', currentElite: 1, targetElite: 2, owned: true, hasMaterialData: true, canTrain: true, progress: 0.35 },
        { id: 'char_202_demkni', name: '塞雷娅', rarity: 6, profession: 'TANK', currentElite: 0, targetElite: 2, owned: true, hasMaterialData: true, canTrain: true, progress: 0.12 },
        { id: 'char_010_chen', name: '陈', rarity: 6, profession: 'WARRIOR', currentElite: 2, targetElite: 2, owned: true, hasMaterialData: true, canTrain: false, disabledReason: 'already_elite2', trainingStatus: 'already_elite2' },
        { id: 'char_103_angel', name: '能天使', rarity: 6, profession: 'SNIPER', currentElite: 1, targetElite: 2, owned: true, hasMaterialData: true, canTrain: true, progress: 0.6 },
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', currentElite: 1, targetElite: 2, owned: true, hasMaterialData: true, canTrain: true, progress: 0.8 },
        { id: 'char_377_gdglow', name: '澄闪', rarity: 6, profession: 'CASTER', currentElite: 0, targetElite: 2, owned: false, hasMaterialData: true, canTrain: false, disabledReason: 'unowned', trainingStatus: 'unowned' },
        { id: 'char_113_cqbw', name: '闪灵', rarity: 6, profession: 'MEDIC', currentElite: 1, targetElite: 2, owned: true, hasMaterialData: false, canTrain: false, disabledReason: 'missing_material_data', trainingStatus: 'missing_material_data' },
        { id: 'char_326_glacus', name: '格劳克斯', rarity: 5, profession: 'SPECIAL', currentElite: 1, targetElite: 2, owned: true, hasMaterialData: true, canTrain: true, progress: 0.05 },
      ],
    }),
  },
  {
    // 此端点的 data 是裸数组：game-data 的 getAllOperators 以 Array.isArray 校验，
    // 训练页的 extractOperatorRows 两种形状都兼容。
    path: '/agent/data/operators',
    payload: ok([
      { id: 'char_180_amgoat', name: '艾雅法拉', rarity: 6, profession: 'CASTER', level: 80, elite: 1, potential: 3 },
      { id: 'char_202_demkni', name: '塞雷娅', rarity: 6, profession: 'TANK', level: 60, elite: 0, potential: 1 },
      { id: 'char_010_chen', name: '陈', rarity: 6, profession: 'WARRIOR', level: 90, elite: 2, potential: 5 },
      { id: 'char_103_angel', name: '能天使', rarity: 6, profession: 'SNIPER', level: 85, elite: 2, potential: 2 },
      { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', level: 70, elite: 1, potential: 6 },
      { id: 'char_326_glacus', name: '格劳克斯', rarity: 5, profession: 'SPECIAL', level: 55, elite: 1, potential: 4 },
    ]),
  },

  {
    path: '/agent/data/operbox',
    payload: ok({
      operCount: 5,
      data: [
        { id: 'char_010_chen', name: '陈', rarity: 6, profession: 'WARRIOR', position: 'MELEE', level: 90, elite: 2, potential: 5 },
        { id: 'char_103_angel', name: '能天使', rarity: 6, profession: 'SNIPER', position: 'RANGED', level: 85, elite: 2, potential: 2 },
        { id: 'char_180_amgoat', name: '艾雅法拉', rarity: 6, profession: 'CASTER', position: 'RANGED', level: 80, elite: 1, potential: 3 },
        { id: 'char_202_demkni', name: '塞雷娅', rarity: 6, profession: 'TANK', position: 'MELEE', level: 60, elite: 0, potential: 1 },
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', position: 'RANGED', level: 70, elite: 1, potential: 6 },
      ],
      allOpers: [
        { id: 'char_010_chen', name: '陈', rarity: 6, owned: true },
        { id: 'char_103_angel', name: '能天使', rarity: 6, owned: true },
        { id: 'char_180_amgoat', name: '艾雅法拉', rarity: 6, owned: true },
        { id: 'char_202_demkni', name: '塞雷娅', rarity: 6, owned: true },
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, owned: true },
        { id: 'char_326_glacus', name: '格劳克斯', rarity: 5, owned: false },
      ],
      operTotal: 6,
      recognition: { status: 'complete', total: 6, owned: 5 },
      timestamp: '2026-10-24 04:00:00',
    }),
  },
  {
    path: '/agent/data/depot',
    payload: ok({
      itemCount: 6,
      items: [
        { id: '30063', name: '聚合剂', iconId: '30063', count: 12, classifyType: 'MATERIAL' },
        { id: '4001', name: '赤金', iconId: '4001', count: 88, classifyType: 'MATERIAL' },
        { id: '30011', name: '固源岩', iconId: '30011', count: 145, classifyType: 'MATERIAL' },
        { id: '30013', name: '固源岩组', iconId: '30013', count: 37, classifyType: 'MATERIAL' },
        { id: '30073', name: '晶体电路', iconId: '30073', count: 21, classifyType: 'MATERIAL' },
        { id: '2004', name: '高级作战记录', iconId: '2004', count: 260, classifyType: 'CARD_EXP' },
      ],
      timestamp: '2026-10-24 04:00:00',
    }),
  },
  {
    path: '/agent/drops/statistics',
    payload: ok({
      total: { sanity: 2456, battles: 89, medicine: 12, stone: 3 },
      items: {
        固源岩: { count: 145, iconId: '30011' },
        固源岩组: { count: 37, iconId: '30013' },
        赤金: { count: 88, iconId: '4001' },
        聚合剂: { count: 6, iconId: '30063' },
        晶体电路: { count: 21, iconId: '30073' },
        高级作战记录: { count: 132, iconId: '2004' },
      },
      stages: {
        '1-7': { battles: 42, sanity: 336, items: { 固源岩: 61 } },
        'CE-6': { battles: 12, sanity: 360, items: { 赤金: 88 } },
        'LS-6': { battles: 20, sanity: 600, items: { 高级作战记录: 132 } },
        'S4-6': { battles: 15, sanity: 135, items: { 固源岩组: 37, 固源岩: 84 } },
      },
      dateRange: { start: '2026-10-18', end: '2026-10-24', days: 7 },
    }),
  },

  {
    path: '/agent/logs/recent',
    payload: ok([
      { time: '2026-10-24T03:59:58+08:00', level: 'INFO', message: '连接模拟器成功（127.0.0.1:5555）' },
      { time: '2026-10-24T03:59:59+08:00', level: 'INFO', message: '开始执行任务：理智作战' },
      { time: '2026-10-24T04:00:00+08:00', level: 'INFO', message: '进入关卡 1-7，第 1/10 次' },
      { time: '2026-10-24T04:00:02+08:00', level: 'WARN', message: '理智不足，等待 6 分钟后继续' },
      { time: '2026-10-24T04:00:05+08:00', level: 'INFO', message: '使用理智药水 ×1，当前理智 82/130' },
      { time: '2026-10-24T04:00:09+08:00', level: 'INFO', message: '关卡 1-7 代理指挥完成，获得固源岩 ×5' },
      { time: '2026-10-24T04:00:12+08:00', level: 'ERROR', message: '识别不到任务界面，正在重试（3/5）' },
      { time: '2026-10-24T04:00:15+08:00', level: 'INFO', message: '界面识别恢复，继续任务流程' },
      { time: '2026-10-24T04:00:18+08:00', level: 'DEBUG', message: '截图耗时 42ms，识别耗时 156ms' },
      { time: '2026-10-24T04:00:21+08:00', level: 'INFO', message: '任务执行完成，累计用时 12 分 38 秒' },
    ]),
  },
  {
    path: '/agent/logs/files',
    payload: ok([
      { name: 'asst.log', path: 'debug/asst.log', size: 245760, modified: '2026-10-24T04:00:21+08:00' },
      { name: 'asst.20261023.log', path: 'debug/asst.20261023.log', size: 1048576, modified: '2026-10-23T23:12:40+08:00' },
      { name: 'asst.20261022.log', path: 'debug/asst.20261022.log', size: 991232, modified: '2026-10-22T22:05:12+08:00' },
      { name: 'gui.log', path: 'debug/gui.log', size: 40960, modified: '2026-10-24T02:48:15+08:00' },
    ]),
  },
  {
    path: '/agent/logs/files/:path',
    payload: ok({ content: '[2026-10-24 04:00:21.000][INFO][yx] 任务执行完成，累计用时 12 分 38 秒' }),
  },

  {
    path: '/agent/version',
    payload: ok({
      core: 'v5.12.3',
      cli: 'v1.4.2',
      raw: 'MAA v5.12.3 / cli v1.4.2',
      resource: {
        lastUpdated: '2026-10-24 03:30:00',
        modifiedAt: '2026-10-24 03:30:00',
        ageDays: 0,
        status: 'current',
        message: '资源与最新版本一致',
      },
    }),
  },
  { path: '/agent/config-directory', payload: ok({ path: '/opt/maa/config' }) },
  {
    path: '/agent/config/maa/default',
    payload: ok({
      connection: {
        adb_path: '/usr/bin/adb',
        address: 'emulator-5554',
        config: 'Official',
        preset: 'ADB',
        auto_reconnect: true,
      },
      instance_options: {
        touch_mode: 'MaaTouch',
        deployment_with_pause: false,
        adb_lite_enabled: false,
        kill_adb_on_exit: false,
      },
    }),
  },
]

export const EXTERNAL_IMAGE_HOSTS = ['raw.githubusercontent.com']

/**
 * 1x1 灰蓝色 PNG（base64）。外部头像/物品图标在浏览器测试中统一渲染为该占位图，
 * 其加载路径（onError 回退等）因此完全确定。
 */
export const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNcOnfpfwAH1QNYRxsAPQAAAABJRU5ErkJggg=='

export async function installPlaceholderAssetRoutes(page: Page): Promise<void> {
  const fulfill = (route: Route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64'),
  })
  for (const host of EXTERNAL_IMAGE_HOSTS) {
    await page.route(`https://${host}/**`, fulfill)
  }
  await page.route('**/game-assets/**', fulfill)
}
