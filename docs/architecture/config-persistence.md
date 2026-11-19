# 配置持久化协调器

> [← 返回文档索引](../README.md)

本文说明 `apps/web/src/features/user-config/` 的持久化协调模型、域适配契约与薄 hooks。肉鸽、作业与自动化分别通过 `features/roguelike/model/roguelikeConfig.ts`、`features/combat/model/combatConfig.ts` 和 `features/automation/model/automationConfig.ts` 适配该协调器。三页的配置加载、草稿、提交与重试都由协调器通道持有。

验证入口见文末[回归证据](#7-回归证据)。

## 1. 定位与边界

协调器是应用级非 React 对象，按配置 key 提供唯一通道。页面可以卸载、`Activity` 可以隐藏，但已接受的草稿与已入队的提交不属于某个页面实例。

| 能力 | 归属 | 不负责 |
| --- | --- | --- |
| 草稿与服务端 wire 编解码、旧格式迁移、本地草稿布局 | 域适配器 | 判断何时提交、是否已被新编辑取代 |
| revision/token、pending 标记、串行提交队列、去抖、重试、加载次序 | 协调器 | 字段语义、端点选择、完整提交条件 |
| 完整提交（配置 + schedule 等域内步骤） | 适配器 `commit` | 跨请求事务、服务端回滚 |
| 渲染、失败提示、成功 toast | 页面 | 再维护一份 pending/revision 状态 |

协调器不把 `saveUserConfig` 成功等同于完整持久化成功：一次提交要写哪些端点、什么条件下才算完成，全部由适配器决定；只有 `commit` 返回 `{ ok: true }` 才清除 pending。

## 2. 协调模型

### 2.1 通道与生命周期

`UserConfigCoordinator.channel(adapter)` 按 `adapter.key` 返回稳定通道。同一 key 重复注册只替换适配器实现，**不重置**草稿、revision、定时器或队列，因此：

- 页面真实卸载后重挂载不会重建提交队列，旧请求与新提交仍按入队顺序执行；
- 已加载的通道重挂载时 `hydrate()` 返回 `skipped`，不会重新读取服务端；需要重新读取时显式 `reload({ force: true })`；
- 适配器必须同构：同一 key 的 `pendingKey`、wire 语义与完整提交条件一致。`pendingKey` 不一致会抛出契约错误，避免两份草稿协议共存。

### 2.2 revision、token 与 pending 标记

每次 `setDraft` 接受一份与当前 wire 内容不同的草稿时：

1. `revision` 递增；
2. 生成新的同步 token，写入适配器的 `pendingKey`；
3. 按 `localWriteDelayMs` 安排写入本地草稿（默认立即写入，见 2.3）；
4. 按适配器策略安排提交（见 2.3）。

提交前后都重新校验「revision 未变 + 内存 token 未变 + 存储中的标记仍是该 token」。因此：

- 旧提交即使成功，也不能清除新草稿的标记或把新草稿标成已同步；
- 旧提交失败不会覆盖新草稿的成功结果，也不会把错误写进新 revision；
- 其他写入者替换了标记时，本次提交不会确认任何草稿。

wire 内容未变的 `setDraft` 会被跳过（默认对 `encodeDraft` 结果做 JSON 比较）；页面从表单状态派生草稿时不会造成重复提交。

### 2.3 提交与本地写策略

`commitDelayMs` 与 `localWriteDelayMs` 是两个独立的时机参数：

- `commitDelayMs`：`0` 表示每次编辑立即入队；大于 `0` 表示提交去抖，只提交最后一次编辑（combat/roguelike/automation 均为 300ms）。
- `localWriteDelayMs`：本地草稿写入延迟，默认 `0`（立即写入）；大于 `0` 时只写最后一次草稿，减少连续输入时的序列化与 `localStorage.setItem` 开销。协调器在提交、`flush`、`dispose` 或页面卸载前强制落盘，因此去抖不会丢失最后一次编辑。automation 使用 250ms。

无论哪种策略，同一 key 的提交都在一条 Promise 队列中串行。连续编辑时，队列中迟到的旧快照在发起请求前即被丢弃，只有最新 revision 会真正写入。

### 2.4 状态

| 字段 | 含义 |
| --- | --- |
| `draft` | 最近接受或加载的草稿；首次加载完成前为 `null` |
| `hydrated` | 是否已有可用草稿。读取彻底失败时为 `false`，下次 `hydrate` 会重试 |
| `pending` | 本设备存在尚未被完整提交确认的草稿 |
| `syncState` | `idle` / `queued`（等待去抖或队列）/ `saving`（正在提交）/ `failed`（当前草稿未完整持久化） |
| `error` | 最近一次同步失败的可展示原因；完整提交成功后清空 |
| `loadState` | `idle` / `loading` / `ready` / `failed`；表示读取与本地恢复的进度，不改变 `hydrated` 语义 |
| `loadError` | 最近一次读取失败的可展示原因；开始新的读取时清空 |
| `revision` | 每次接受新草稿递增 |
| `lastSavedAt` | 最近一次完整提交成功的时间戳 |

```
setDraft ─→ queued ─→ saving ─→ idle
                  └──────────→ failed ──commitNow()──→ saving ─→ …
恢复未同步草稿 ─────────────────────→ failed（pending=true）
reload() ─→ loaded / local-draft / skipped / stale / failed
```

### 2.5 跨域写入屏障

`UserConfigCoordinator.settle(keys)` 等待指定 key 已入队的提交全部结束，并返回仍未确认的
`pendingKeys`。它用于一个域即将改写另一个域负责的服务端文件时先排空旧保存，例如 training
应用养成计划前等待 `automation-tasks` 的保存。`settle` 不触发失败草稿的自动重试，也不创建
尚未挂载的通道；除内存通道外，它还会按 `USER_CONFIG_PENDING_KEYS` 检查本地 pending token，
因此上一次会话保存失败、当前页面未挂载的草稿同样会被报告。调用方必须根据 `pendingKeys`
决定是否继续。key 与 pending 键常量由 `USER_CONFIG_KEYS` / `USER_CONFIG_PENDING_KEYS`
统一导出，避免各域复制字符串。

## 3. 适配契约

```ts
export interface ConfigPersistenceAdapter<TDraft, TWire = unknown> {
  readonly key: string
  readonly pendingKey: string
  readonly commitDelayMs?: number
  /** 本地草稿写入去抖；默认 0（立即写入）。提交、flush、dispose 或页面卸载前强制落盘。 */
  readonly localWriteDelayMs?: number
  readonly restoredMessage?: string
  readonly formatFailure?: (message: string) => string
  encodeDraft(draft: TDraft): TWire
  decodeDraft(payload: unknown): TDraft | null
  readLocalDraft(): TDraft | null
  writeLocalDraft(draft: TDraft): void
  commit(wire: TWire): Promise<ConfigCommitResult>
  fetch(options: { signal: AbortSignal }): Promise<ConfigLoadResult>
  fingerprint?(draft: TDraft): string
}
```

| 成员 | 要求 |
| --- | --- |
| `key` / `pendingKey` | 沿用服务端 key 与既有本地标记键；同一 key 的适配器必须同构 |
| `encodeDraft` | 只输出持久化需要的字段；界面字段（图标、参数表单）不得进入 wire，否则指纹与提交通道都被污染 |
| `decodeDraft` | 同时承担旧值迁移与形状校验；返回 `null` 表示载荷不可用，协调器回退本地草稿。字段级合并与默认值策略属于适配器 |
| `readLocalDraft` | 缺失或损坏时返回 `null` 并清理损坏键，不要抛出；存在 pending 标记但返回 `null` 时，协调器删除标记并继续读服务端 |
| `writeLocalDraft` | 与读取对称；服务端加载成功、接受编辑、加载本地回退时都会被调用。`localWriteDelayMs > 0` 时协调器去抖，并在提交、`flush`、`dispose` 或页面卸载前强制写入最后一次草稿 |
| `commit` | **完整提交**：所有域内写入全部成功才返回 `ok`。返回 `{ ok: false, message }` 或抛出都会保留 pending 与重试入口 |
| `fetch` | 应响应 `signal` 中止；结果只提供载荷，形状校验交给 `decodeDraft` |
| `fingerprint` | 可选；默认对 wire 做 JSON 序列化。用于跳过内容等价的编辑 |
| `restoredMessage` / `formatFailure` | 可选文案钩子；默认文案见 `DEFAULT_RESTORED_MESSAGE` 与 `model/configCoordinator.ts` |

完整提交的典型形态（automation 的真实实现见 6.3）：

```ts
async commit(wire) {
  const saved = await saveUserConfig('automation-tasks', {
    taskFlow: wire.taskFlow,
    schedule: { enabled: wire.schedule.enabled, times: wire.schedule.times },
  })
  if (!saved.success) return { ok: false, message: getErrorMessage(saved) }

  const schedule = wire.schedule.enabled && wire.schedule.times.length > 0
    ? await setupSchedule('default', wire.schedule.times, wire.taskFlow)
    : await stopSchedule('default')
  return schedule.success ? { ok: true } : { ok: false, message: getErrorMessage(schedule) }
}
```

配置已保存而 schedule 失败时返回 `ok: false`，协调器保留 pending；重试重新执行整段 `commit`。这不声称跨请求已获得事务原子性，只保证不会把半完成的写入当作已同步。

## 4. 薄 hooks

```tsx
import { useUserConfig, type ConfigPersistenceAdapter } from '@/features/user-config'

const adapter: ConfigPersistenceAdapter<CombatDraft, CombatWire> = { /* 域内常量，见第 6 节 */ }

function CombatWorkspace() {
  const { draft, hydrated, pending, syncState, error, update, retry, reload } = useUserConfig(adapter)
  // draft 渲染表单；update 接受编辑；retry 绑定“重新同步”；reload({ force: true }) 用于外部写入后强制重读
}
```

| 返回 | 说明 |
| --- | --- |
| `draft` / `hydrated` / `pending` / `syncState` / `error` / `loadState` / `loadError` / `revision` / `lastSavedAt` | 协调器状态；`useSyncExternalStore` 订阅，状态对象只在变化时替换 |
| `update(draft)` | 等价于通道 `setDraft`：写本地、刷新 revision/token、按策略提交 |
| `retry()` | 立即提交当前草稿并等待**本次**尝试；返回当前 revision 是否已确认 |
| `reload({ force })` | 重新读取；`force` 绕过已加载守卫 |
| `channel` | 非渲染场景（事件监听、卸载前刷新）直接访问通道 |

`autoHydrate: false` 时 hook 不自动加载，由调用方在合适的时机调用 `reload()`。hook 不在卸载时取消队列，也不写任何全局状态。

## 5. 加载、刷新与外部写入

`reload()` 的优先级与结果：

| 场景 | 行为 | 结果 |
| --- | --- | --- |
| 本设备有 pending 标记且草稿可读 | 直接采用本地草稿，不请求服务端 | `local-draft` |
| pending 标记但没有可读草稿 | 删除标记，继续读服务端 | 视服务端结果 |
| 已加载且未强制 | 不做任何请求 | `skipped` |
| 服务端载荷可用 | 采用服务端草稿、迁移并回写本地 | `loaded` |
| 服务端失败或载荷不可用 | 回退本地草稿；都没有则不标记已加载 | `loaded`（本地）/ `failed` |
| 加载期间出现新编辑或新加载 | 丢弃本次响应 | `stale` |

关键约束：

- **未确认草稿优先**：`force` 也不覆盖它。外部写入（如养成计划应用）在应用前通过 `UserConfigCoordinator.settle()` 排空本设备 automation 的在途保存；仍有未确认草稿时 training 拒绝应用。应用后的 `automation-config`/`automation-schedule` 失效由 automation 页面处理：先 `flush()` 通道，再 `reload({ force: true })`；返回 `local-draft`/`stale` 时保留本地并提示。
- **迟到加载不写回**：加载返回时校验加载序号、`AbortSignal`、revision 与 pending 标记；任何一项变化都返回 `stale`。
- **损坏草稿可回退**：单个损坏键由适配器清理；标记指向的草稿整体不可读时删除标记并读服务端，不会永久停在“本地优先”。
- **读取失败会重试**：`failed` 不标记 `hydrated`，`Activity` 恢复或下次挂载会再次尝试；服务端失败且本地有草稿时静默回退，不打断编辑。
- **读取状态可观察**：`loadState` 在读取开始时进入 `loading`，拿到服务端或本地草稿后进入 `ready`，没有可回退草稿时进入 `failed` 并带上 `loadError`；已有内存草稿时强制重读失败仍保持 `ready`，不会隐藏已有草稿的编辑器。`hydrated` 仍只表示“已有可用草稿”，三个状态与它各自独立。日常页只在 `ready` 时渲染编辑器，`loading`/`failed` 使用只读占位，`failed` 的重新加载走 `reload({ force: true })`。

### 跨页面读写的一致性

三域的未确认草稿始终优先于服务端读取；页面隐藏或卸载只清理 UI Effects，不取消协调器已经接受的串行提交。成功写入只有在 revision 与 pending 令牌仍匹配当前草稿时才能清除标记。迟到加载须同时通过加载序号、AbortSignal、revision 与 pending 校验，不得覆盖编辑。

自动化的配置和 schedule 更新是一个完整提交单元：配置成功但 schedule 失败时必须保留 pending，显式重试整段操作，不得展示已同步状态。跨域应用养成计划前须先排空本设备的配置写入，若草稿仍未确认则拒绝覆盖；计划应用成功后使用失效端口强制重读，未确认草稿继续保留。设置页 MAA connection 不属于这个协调器，其读取令牌与草稿语义由[设置配置编辑与保存](../frontend/domains/settings.md#配置编辑与保存)独立约束。跨页失效作用域见[共享资源归属与失效端口](resource-ownership.md)，总览的原子快照规则见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)。

## 6. 三域适配边界

以下清单是各域目前的配置契约。更改加载、保存或重试行为时，必须保持既有 key、格式和用户数据。

| 项目 | Combat | Roguelike | Automation |
| --- | --- | --- | --- |
| 配置 key | `combat-tasks` | `roguelike-tasks` | `automation-tasks` |
| 本地草稿 | `combatTaskInputs`、`combatAdvancedParams`、`combatAutoFormation`、`combatCopilotSetExecutionMode`、`combatCopilotSetSelections` | `roguelikeTaskInputs`、`roguelikeAdvancedParams` | `maa-task-flow`、`maa-schedule` |
| pending 键 | `combatConfigSyncPending` | `roguelikeConfigSyncPending` | `automationConfigSyncPending` |
| 提交时机 | 300ms 提交去抖 | 300ms 提交去抖 | 300ms 提交去抖 + 250ms 本地写去抖 |
| 加载迁移 | `app`→`cli`；raid `1`/`2`→`raid`/`both` | `advancedParams.reclamation.mode` 缺失或空值按当前主题补为合法首项（沙洲遗闻 `1`、重启锚点 `16`）；不单独触发保存 | `times`→`entries` 兼容；禁用项只留在本地 |
| 完整提交 | `saveUserConfig` | `saveUserConfig` | `saveUserConfig` + `setupSchedule`/`stopSchedule` |

接入时的额外边界：

- 工作区只订阅与编辑通道，不建立第二份 revision、pending 状态或保存队列。
- `Activity` 隐藏/恢复只影响 Effects；`hydrate()` 的已加载守卫保证恢复时不重读，pending 草稿仍优先。
- automation 订阅 `automation-config`/`automation-schedule` 失效后通过 `reload({ force: true })` 重读；返回 `local-draft` 时不得丢弃本地编辑。计划应用不再使用 window `training-plan-applied` 事件。
- 成功/失败通知由页面通过固定 id 的 `notify` 发送；automation 的保存/恢复失败使用 `automation-config-save`，成功清除错误后关闭同 id toast，页内不再派生错误文案；协调器不直接写 `statusStore` 或通知器。

### 6.1 肉鸽适配器

`features/roguelike/model/roguelikeConfig.ts` 定义肉鸽配置适配器，协调器通道持有草稿与提交；`RoguelikeWorkspace` 通过 `useUserConfig` 订阅与编辑，`pages/roguelike/RoguelikeTasks.tsx` 只组合工作区。

| 项目 | 实现 |
| --- | --- |
| 身份 | key `roguelike-tasks`；pending 键 `roguelikeConfigSyncPending` |
| 本地草稿 | `roguelikeTaskInputs`、`roguelikeAdvancedParams`，逐字段写回原布局；单个损坏键清理后丢弃该字段，两个键都不可读才返回 null 并让协调器删除 pending 标记、改读服务端 |
| 加载迁移 | 解码与本地读取时把 `advancedParams.reclamation.mode` 的缺失或空值按当前主题补为合法首项：沙洲遗闻补 `1`，重启锚点补 `16`；编码与写本地草稿同样补齐，因此旧配置或新用户的下一次编辑提交一定包含该值。迁移不单独触发保存 |
| wire | `{ taskInputs, advancedParams }`；解码时缺少字段按空草稿补齐并应用上述迁移，字段存在但类型不合法时整份载荷不可用并回退本地草稿 |
| 提交时机 | `commitDelayMs = 300`，连续编辑只提交最后一次 |
| 完整提交 | `saveUserConfig('roguelike-tasks', wire)` 成功即完成；失败或传输异常保留 pending 与重试入口 |
| 页面派生 | `taskInputs`/`advancedParams` 从 `draft` 派生；错误文案取协调器 `error`，重试按钮的 loading 取 `syncState === 'saving'`；仅手动 `retry()` 返回 true 时提示“肉鸽配置已同步” |

兼容约束：保留配置 key、本地键、pending 键与 wire 形状；迟到加载须由协调器按 revision/pending 裁决，不得覆盖当前编辑。默认值补齐只增加 `reclamation.mode` 与集成战略的 `roles`，显式值与未知扩展字段原样保留；只使用集成战略的草稿在提交时也会携带 `reclamation.mode`。新增高级字段（如 `incrementMode`、`clearStore`、黑流树海参数）不需要迁移：旧草稿缺失时按未设置处理，不触发额外保存。

### 6.2 作业适配器

`features/combat/model/combatConfig.ts` 定义作业配置适配器，协调器通道持有草稿与提交；`CombatWorkspace` 通过 `useUserConfig` 订阅与编辑，`pages/combat/CombatTasks.tsx` 只组合工作区。

| 项目 | 实现 |
| --- | --- |
| 身份 | key `combat-tasks`；pending 键 `combatConfigSyncPending` |
| 本地草稿 | `combatTaskInputs`、`combatAdvancedParams`、`combatAutoFormation`、`combatCopilotSetExecutionMode`、`combatCopilotSetSelections`；执行方式沿用裸字符串布局，其余为 JSON。单个损坏键清理后丢弃该字段，全部不可读才返回 null 并让协调器删除 pending 标记、改读服务端 |
| wire | `{ taskInputs, advancedParams, autoFormation, copilotSetExecutionMode, copilotSetSelections }`；缺失字段按默认草稿补齐，字段存在但类型不合法时整份载荷不可用并回退本地草稿 |
| 加载迁移 | 服务端与本地两条路径都把 `app` 迁移为 `cli`；`advancedParams.copilot.raid` 的 `1`/`2` 规范化为 `raid`/`both`。迁移不单独触发保存；服务端不可用而采用本地草稿时会把规范化结果写回本地 |
| 提交时机 | `commitDelayMs = 300`，连续编辑只提交最后一次 |
| 完整提交 | `saveUserConfig('combat-tasks', wire)` 成功即完成；失败或传输异常保留 pending 与重试入口 |
| 页面派生 | 五个配置字段都从 `draft` 派生；错误文案取协调器 `error`，重试按钮的 loading 取 `syncState === 'saving'`；仅手动 `retry()` 返回 true 时提示“自动战斗配置已同步” |

默认草稿中 copilot 忽略干员要求、循环 1 次、失败继续、难度按作业标注（`auto`），作业集默认 `cli`。兼容约束：保留配置 key、本地键、pending 键与 wire 形状；服务端已知字段类型不合法时整份载荷回退本地草稿，不能采用部分异常值。迟到加载须由协调器裁决。

### 6.3 自动化适配器

`features/automation/model/automationConfig.ts` 定义 task flow 与 schedule 的共同适配器；`AutomationWorkspace` 通过 `useUserConfig` 订阅与编辑，`pages/automation/AutomationTasks.tsx` 只组合工作区。两个编辑模型共用一个协调器通道。

| 项目 | 实现 |
| --- | --- |
| 身份 | key `automation-tasks`；pending 键 `automationConfigSyncPending` |
| 本地草稿 | `maa-task-flow`（任务数组）与 `maa-schedule`（`{ enabled, times, entries }`）；单个键损坏清理后丢弃该部分，两个键都不可读才返回 null 并让协调器删除 pending 标记、改读服务端 |
| wire | `{ taskFlow, schedule: { enabled, times } }`；task flow 去掉 `icon`/`paramFields` 等界面字段，其余旧字段（如 `name`、`description`、`defaultParams`、`taskType`）原样保留；`times` 只包含启用的时间点 |
| 加载迁移 | 兼容 `maa-schedule.entries` 与旧 `times`；`times` 为空时保留默认执行时间；任务条目在解码与本地读取时归一化：缺失 `commandId` 时从 `id` 前缀推导，已知任务用任务目录 `defaultParams` 补齐缺失参数且已有参数优先，`enabled` 缺省为 `true`，`name` 缺失时回退目录名称或 `commandId`，未知任务保留可读名称与已有参数（仅原始 `params` 不是对象时才回退 `{}`）。既有参数迁移（`skip_robot`→`preserve_tags`、新旧字段补齐）、启动/关闭客户端类型同步、关闭游戏置底仍在同一路径执行；只有 task flow 不是数组、条目不是对象或缺 `id` 时才拒绝整份草稿 |
| 提交时机 | `commitDelayMs = 300` + `localWriteDelayMs = 250`；连续编辑只提交最后一次，本地草稿也只写最后一次；提交、`flush`、`dispose` 或页面卸载前强制落盘 |
| 草稿等价 | 适配器 `fingerprint` 比较 task flow 与本地 `schedule.entries`，而不是只看 wire；编辑或删除禁用时间点仍会接受草稿、写回本地并触发提交，不会被协调器当成无变化而静默丢弃。wire 未变化时这次提交内容与上一次相同，属于幂等写入 |
| 完整提交 | `saveUserConfig('automation-tasks', wire)` 成功后再执行 `setupSchedule('default', times, taskFlow)`（启用且存在时间点）或 `stopSchedule('default')`；任一步失败都返回 `ok: false`，协调器保留 pending 与“重新同步”入口，重试重跑整段提交 |
| 过期提交保护 | 配置保存期间若协调器接受了更新的草稿，适配器在 schedule 步骤前比对最新 wire 指纹并跳过旧 schedule；即使旧提交已经写入配置，协调器也不会用它的结果确认新 revision |
| 外部写入裁决 | training 应用计划前调用 `userConfigCoordinator.settle([USER_CONFIG_KEYS.automationTasks])`，等本设备已入队的保存落盘，并按 `USER_CONFIG_PENDING_KEYS` 检查未挂载页面的持久化标记；仍有 pending 时拒绝应用。`automation-config`/`automation-schedule` 失效到达后，页面先 `flush()` 再 `reload({ force: true })`：`loaded` 采用服务端副本并提示更新，`local-draft`/`stale` 保留本地草稿并提示。采用服务端副本时保留本设备独有的禁用时间点（`mergeLocalScheduleEntries`），避免非冲突的本地 schedule 编辑丢失。跨客户端同时写入仍是最后写入生效 |
| 页面派生 | task flow 的图标与参数表单由 `AVAILABLE_TASKS` 派生；schedule 的启用状态与条目都从 `draft` 派生；错误文案取协调器 `error`，保存/恢复失败以固定 id 的 error toast 展示并提供“重新同步” action，成功清除错误后关闭同 id toast |
| 页面局部状态 | 拖拽中的顺序由 `hooks/useTaskFlowSorting` 渲染本地预览，松手时才作为一次编辑写入协调器；选中项、连接测试反馈与删除撤销 toast 归 `AutomationWorkspace`，picker 与执行详情分别归 `AutomationTaskPicker`、`AutomationExecutionSummary`；`isRunning`/`isSubmitting` 期间流程编辑锁定，定时与通知卡仍按各自状态独立保存；当前工作区仍只调用 `useUserConfig` 的 `update`，面板不持有保存队列 |

pending 标记存在但本地草稿不可读时，协调器必须删除该标记并回退服务端；该行为由适配器回归固定。

兼容约束：保留配置 key、本地键、pending 键与 wire 形状；服务端载荷只有不可恢复形状（非对象、task flow 非数组、条目缺 `id`）才整份回退本地草稿，单条任务的可恢复字段缺失由归一化补齐。保存失败时通过固定 id 的 error toast 与“重新同步” action 反馈，保留 pending 草稿；跨会话恢复草稿时同样以该 toast 提示并可重试。配置未 `ready` 时日常页不渲染可编辑表单；不得为了回滚清理用户存储，也不得因配置加载失败覆盖未确认草稿。

## 7. 回归证据

| 测试 | 覆盖 |
| --- | --- |
| `features/user-config/model/configCoordinator.test.ts` | 非 React：服务端加载与迁移、加载/失败状态与恢复、未同步草稿优先、损坏草稿回退、迟到加载丢弃、强制刷新中止旧加载、提交串行与旧提交不确认新草稿、标记被外部替换、提交去抖合并、本地写去抖与提交/卸载前 flush、内容等价跳过、完整提交失败与重试防重入、编辑中断重试、跨重挂载队列与状态、异构适配器拒绝、`settle` 写入屏障等待在途提交并报告失败草稿 |
| `features/user-config/hooks/useUserConfig.test.tsx` | 首次加载与订阅渲染、`loadState`/`loadError` 与恢复、编辑写回、`autoHydrate: false`、失败提示与重试后清空 |
| `features/roguelike/model/roguelikeConfig.test.ts` | 肉鸽适配器：原 key/pending/本地键/300ms、wire 形状、缺省字段与非法载荷解码、本地键损坏清理、完整提交与读取失败信封 |
| `pages/roguelike/RoguelikeTasks.test.tsx` | 页面接线：pending 跨 remount + 重试、重试防重入与成功提示、提交串行与旧响应保护、坏草稿回退服务端、迟到加载不覆盖编辑、Activity 隐藏/恢复 |
| `features/combat/model/combatConfig.test.ts` | 作业适配器：原 key/pending/本地键/300ms、wire 形状、`app→cli` 与 raid `1`/`2` 迁移、缺省字段与非法载荷解码、本地键损坏清理、裸字符串执行方式、完整提交与读取失败信封 |
| `pages/combat/CombatTasks.test.tsx` | 页面接线：pending 跨 remount + 重试、重试防重入与成功提示、提交串行与旧响应保护、迟到加载不覆盖编辑、坏草稿回退服务端、本地与服务端 `app→cli`/raid 迁移、set 模式与待执行索引回填、Activity 隐藏/恢复 |
| `features/automation/model/automationConfig.test.ts` | 自动化适配器：原 key/pending/本地键、300ms 提交去抖 + 250ms 本地写去抖、wire 去掉界面字段、`entries`/`times` 兼容、任务条目归一化（缺 `commandId`/`params`/`name`/`enabled`、未知命令、显式参数优先）、任务参数迁移与客户端类型同步、不可恢复载荷拒绝、本地键损坏清理、配置+schedule 完整提交、schedule 半失败、保存期间新草稿跳过旧 schedule、禁用项参与的本地草稿指纹、读取失败信封 |
| `pages/automation/AutomationTasks.config.test.tsx` | 页面接线：读取中/失败门控与强制重载恢复、配置/schedule 全成功才清 pending、保存失败不碰 schedule 且保留编辑、保存错误 toast 重试、禁用与全禁用 schedule、编辑/删除禁用时间点仍写回本地、跨 remount 串行提交与旧响应保护、stale pending 回退服务端、计划失效重读等待在途保存、Activity 恢复补发及本地禁用时间点保留 |
| `pages/automation/AutomationTasks.layout.test.tsx` | pending 本地优先、hydrate 不重建 schedule、Activity 恢复、拖拽/表单接线、删除撤销与连接测试 toast |
| `pages/automation/AutomationTasks.execution.test.tsx` | Run 提交、停止、提交期间流程编辑锁定、删除撤销在运行中拒绝、流程进度与旧断点只观察不重提 |

复现命令（仓库根目录）：

```sh
pnpm --filter la-pluma-next-client verify
```

三域必须保持既有配置 key、本地键与服务端 wire；自动化额外兼容 `entries`/`times` 及任务参数旧格式，无须手工迁移本地草稿。automation 同步失败使用固定 id toast 与 action 重试；`role="alert"` 仅适用于仍保留页内反馈的域，不改变成功路径的默认视觉。

## 关联

- [开发文档](../development/README.md)：测试治理与常用检查。
