# 通用组件库

> [← 返回文档索引](../README.md)
>
> 视觉与交互规则以根目录 [设计规范](../../DESIGN.md) 为唯一来源；本文件只记录组件 API、用法与页面落地清单。

## 概述

为了减少重复代码、统一视觉风格、提升开发效率，项目维护一套通用 UI 组件。shadcn CLI 生成的上游原语位于 `apps/web/src/shared/ui/`，随上游原样保留；`Button`、`Input`、`Select`、`Checkbox`、`Switch`、`Card` 等控件直接从对应的 `@/shared/ui/*` 模块导入。应用层组合组件位于 `apps/web/src/shared/components/*.tsx`，通过 `apps/web/src/shared/components/index.ts` 统一导出，页面从 `@/shared/components` 引入。本文件记录生成原语的组合用法与必须遵循的应用层约定。

加载占位直接使用 `@/shared/ui/skeleton` 的 `Skeleton`，不要在应用层重写 shimmer 或另建骨架原语。页面根统一使用 `PageShell`，页面标题归 `Layout` 顶栏所有，页面只提供工作区内容。

新增或调整组件时，在本文件补充 API 与用法；颜色、字号、间距、圆角、交互状态等规则不要在组件文档里另写一份。

---

## 组件列表

### Card - 卡片组件

**文件位置**：`apps/web/src/shared/ui/card.tsx`（shadcn 生成物，随上游原文保留）

**适用场景**：卡片、信息区块、带标题的内容区域与独立工作区面板。

```tsx
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'

<Card>
  <CardHeader>
    <CardTitle role="heading" aria-level={3}>材料掉落统计</CardTitle>
    <CardDescription>最近一次作战的掉落汇总。</CardDescription>
    <CardAction><Button size="sm">刷新</Button></CardAction>
  </CardHeader>
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
  <CardFooter>
    <p>页脚说明</p>
  </CardFooter>
</Card>

<Card className="roguelike-theme-panel gap-0 p-0!">
  <div className="border-b border-border px-4 py-3.5">分节标题</div>
  <div className="px-4 py-4">自管理内边距的面板内容</div>
</Card>
```

`Card` 使用 shadcn 语义 token（`bg-card`、`ring-foreground/10`、`--card-spacing`）与普通圆角；标题、描述、操作分别使用 `CardTitle`、`CardDescription`、`CardAction`，页脚使用 `CardFooter`。需要分节面板且各分节自持内边距时，给 `Card` 加 `gap-0 p-0!`，不再引入独立面板包装组件。标题需要保留文档层级时，在 `CardTitle` 上使用 `role="heading"` 与 `aria-level`。紧凑提示容器使用语义类 `app-info-card` 配合对应状态类；`surface-panel` 继续用于主题菜单与 PWA 提示等应用自绘召唤层，不用于 `Card` 或 shadcn 生成弹层。

所有页面根统一使用下方的 `PageShell`：工作台页设置 `layout="workspace"`，无边框卡片页再设置 `surface="borderless"`。页面标题由 `Layout` 顶栏统一渲染，页面内不再声明标题或副标题。卡片材质统一由 shadcn 语义 token 控制，不要在页面级另造卡片材质。

---

### PageShell - 页面壳

**文件位置**：`apps/web/src/shared/components/PageShell.tsx`

**适用场景**：所有路由页面与主题画廊的根节点。页面只提供内容，标题与页头归 `Layout` 顶栏。

```tsx
import { PageShell } from '@/shared/components'

<PageShell pageKind="automation" layout="workspace" surface="borderless">
  <AutomationWorkspace />
</PageShell>
```

Props：`pageKind`（`AppTab` 或 `gallery`，必填）、`layout`（工作台页为 `workspace`）、`surface`（无边框卡片页为 `borderless`）、`className`、`children`；其余原生 `div` 属性（如 `aria-busy`、`aria-label`）直接透传。根节点固定输出 `app-page`、`data-region="page"` 与 `data-page-kind`，有值时输出 `data-page-layout` / `data-page-surface`；内部固定一个 `app-stack-section` 承载内容。

页面根只用 `PageShell`，不要恢复页面级 `ios-*` 类或旧 data 属性；布局、视觉与浏览器测试通过 `data-region` / `data-page-*` 定位。

---

### DeviceMonitorLayout - 设备画面布局

**文件位置**：`apps/web/src/features/device-mirror/components/DeviceMonitorPanel.tsx`

**适用场景**：工作区把页面内容与共享设备画面（`DeviceMonitorPanel`）组合为统一网格。页面只提供具名区域，网格、monitor 列与画面渲染由本组件持有；不要在页面另写设备画面网格或重复渲染 `DeviceMonitorPanel`。

```tsx
import { DeviceMonitorLayout } from '@/features/device-mirror'

// standard：内容主列 + 设备画面（日志、数据、养成、作业）
<DeviceMonitorLayout variant="standard">
  <WorkspaceContent />
</DeviceMonitorLayout>

// workbench：任务流程 / 任务配置 / 支撑列（日常）
<DeviceMonitorLayout
  variant="workbench"
  sequence={<AutomationTaskFlowPanel ... />}
  editor={<div data-monitor-area="editor">...</div>}
  support={<><AutomationScheduleCard ... /><NotificationSettings /></>}
/>

// mode：模式导航 + display: contents 面板（肉鸽）
<DeviceMonitorLayout
  variant="mode"
  mode={<RoguelikeModePanel ... />}
  content={<SegmentedTabPanel className="contents">...</SegmentedTabPanel>}
/>
```

Props 是 discriminated union：`standard` 接收 `children`；`workbench` 接收 `sequence`、`editor`、`support`；`mode` 接收 `mode`、`content`。不提供列数、区域、间距或画面位置等通用网格配置。

根节点输出 `data-device-monitor-layout="standard|workbench|mode"`，区域输出 `data-monitor-area`（`main`、`monitor`、`sequence`、`editor`、`support`、`mode`、`settings`）。`standard` 的 `main`/`monitor` 和各 variant 的 `monitor` 由布局渲染；`workbench` 的 `sequence`/`editor`、`mode` 的 `mode` 以及 `main`/`settings` 由页面提供的根节点携带，布局不克隆或包裹这些节点。`mode` 的 `content` 保持页面传入的 `display: contents` 面板，由内部的 `main`/`settings` 参与网格。

`standard` 的 monitor 列在视口小于 1360px 且内容宽度超过 48rem 时使用 `max-width: 48rem` 并居中；视口达到 1360px 后改用三列网格并解除该上限。组件持有 grid 根节点 DOM、`monitor` 区域与 monitor 列；`workbench`/`mode` 的页面网格模板与断点仍由对应页面样式（`automation.css` / `roguelike.css`）提供，页面只通过 `data-monitor-area` 提供具名区域。

`data-region="monitor"` 仍只由 `DeviceMonitorPanel` 的卡片输出，每个页面恰好一个。概览页的设备卡片不纳入此布局，不输出 `data-device-monitor-layout`，也不渲染 `data-region="monitor"`。

共享设备画面样式归 `features/device-mirror/styles/device-mirror.css`：画面根节点为 `device-monitor-surface`，`workbench`/`mode` 的 monitor 列与面板为 `device-monitor-column` / `device-monitor-panel`，紧凑玻璃按钮为 `device-preview-glass-button`；`standard` 继续使用 `task-monitor-*` 布局类。页面不得新增 `automation-*` / `roguelike-*` monitor 类，也不得按 `data-page-kind` 切换设备画面样式。

---

### SegmentedTabs - 分段页面导航

**文件位置**：`apps/web/src/shared/components/SegmentedTabs.tsx`（组合 `@/shared/ui/tabs` 的 shadcn Base UI 原语）

**适用场景**：页面内一级视图切换，例如配置 section、作业类型、肉鸽模式与统计视图。三个同源导出必须一起使用：`SegmentedTabs` 提供受控 Tabs 上下文，`SegmentedTabNav` 渲染分段标签，`SegmentedTabPanel` 渲染对应面板。页面不再手写 tablist、`aria-pressed` 按钮或高亮测量。

```tsx
import { SegmentedTabs, SegmentedTabNav, SegmentedTabPanel } from '@/shared/components'

<SegmentedTabs value={activeTab} onValueChange={setActiveTab}>
  <SegmentedTabNav
    ariaLabel="数据统计视图"
    value={activeTab}
    options={options}
    tabId={id => `statistics-tab-${id}`}
    panelId={id => `statistics-panel-${id}`}
  />
  <SegmentedTabPanel value="operbox" id="statistics-panel-operbox" keepMounted>
    干员面板
  </SegmentedTabPanel>
  <SegmentedTabPanel value="depot" id="statistics-panel-depot" keepMounted>
    仓库面板
  </SegmentedTabPanel>
  <SegmentedTabPanel value="drops" id="statistics-panel-drops" keepMounted>
    <DropPanel isActive={activeTab === 'drops'} />
  </SegmentedTabPanel>
</SegmentedTabs>
```

- `SegmentedTabs` 的根节点使用 `display: contents`，不引入额外布局层；tab 导航与面板可以继续作为原网格或弹性布局的直接子项。
- `SegmentedTabNav` 保留 `app-workspace-segments`、`app-liquid-tab-pill`、`app-workspace-segment-list`、`app-workspace-segment-indicator`、`app-workspace-segment(-icon|-copy)`、`is-selected` 与流体高亮。`className`、`listClassName`、`indicatorClassName`、`tabClassName`、`iconClassName` 只承载页面差异；测量复用 `useFluidTabIndicator`，不要逐页复制。
- 标签使用 Base UI 的 tablist/tab 语义，`activateOnFocus` 固定为 `false`：左右方向键、Home、End 只移动 roving focus，Enter、Space 或点击才切换选中项。不要恢复方向键直接激活的旧行为。
- `tabId` / `panelId` 可选：传入时提供稳定 id 与 `aria-controls`，省略时由 Base UI 生成并注册关联。`panelId` 只能指向当前实际渲染的面板；默认卸载的页面只在当前 tab 上返回 `panelId`，避免 `aria-controls` 指向不存在的元素。`SegmentedTabPanel` 的 `id` 同样可选；输出 `role="tabpanel"` 与 `aria-labelledby`。如果给面板传 `id`，对应 tab 必须传相同的 `panelId`；或者两侧都省略，交给 Base UI 生成。只传一侧会破坏关联。不传 `keepMounted` 时隐藏面板卸载，传 `true` 时保留 DOM 并设置 `hidden`。配置与统计需要保留草稿、反馈、Query 与统计周期，使用 `keepMounted`；作业使用默认卸载；肉鸽使用始终打开的单个 `contents` 面板承载跨 grid-area 内容。
- 无法把整块内容包进面板时（例如肉鸽网格的多个 grid-area），保留原网格，把模式相关区域放进单个 `className="contents"` 的面板，并让所有 tab 指向同一个 `panelId`。

---

### SegmentedControl - 单值分段控件

**文件位置**：`apps/web/src/shared/components/SegmentedControl.tsx`（组合 `@/shared/ui/toggle-group` 的 shadcn Base UI 原语）

**适用场景**：表单内的互斥选项，例如编队与执行方式。不要再写私有的分段按钮组件。

```tsx
import { SegmentedControl, type SegmentedControlOption } from '@/shared/components'

const FORMATION_OPTIONS: readonly SegmentedControlOption<FormationMode>[] = [
  { value: 'auto', label: '自动决定' },
  { value: 'on', label: '自动编队' },
  { value: 'off', label: '保留当前编队' },
]

<SegmentedControl
  ariaLabel="编队"
  value={formationMode}
  options={FORMATION_OPTIONS}
  onChange={onFormationChange}
  fullWidth
/>
```

Props：`ariaLabel`、`value`、`options`（每项 `value`、`label`、可选 `disabled`）、`onChange`、`fullWidth`、`disabled`、`className`。控件使用 `role="group"` 与 `aria-pressed`，单选且始终保留一个选中项；点击已选项不会清空选择。按钮保持 `min-h-11` 触达高度，选中态沿用 `brand-action` 视觉。

---

### Button

**文件位置**：`apps/web/src/shared/ui/button.tsx`（shadcn 生成物，随上游原文保留）

**适用场景**：文本按钮、主要操作、危险操作与图标按钮。

```tsx
import { Button } from '@/shared/ui/button'
import { LoaderCircle, RefreshCw, Save } from 'lucide-react'

<Button><Save aria-hidden="true" />保存</Button>
<Button variant="destructive" disabled={deleting} aria-busy={deleting || undefined}>
  {deleting ? <><LoaderCircle className="animate-spin" aria-hidden="true" />删除中</> : '删除'}
</Button>
<Button variant="ghost" size="icon" title="刷新" aria-label="刷新">
  <RefreshCw aria-hidden="true" />
</Button>
```

`Button` 的 `variant` 为 `default`、`secondary`、`outline`、`ghost`、`destructive`、`link`；`size` 为 `xs`、`sm`、`default`、`lg`、`icon-xs`、`icon-sm`、`icon`、`icon-lg`。新增按钮优先使用这些档位，不要在页面里手写一套按钮颜色、阴影和圆角。

图标作为按钮的 children 直接渲染，并添加 `aria-hidden="true"`；图标尺寸由生成组件的内建规则处理，不要在调用处传旧的 `icon` prop 或覆盖图标与文字间距。无文字操作使用 `size="icon"` 档位，调用时必须同时提供 `title` 和 `aria-label`。

loading 不是 `Button` 的 prop：调用点用 `disabled` 阻止重复提交，加 `aria-busy`，并用 `LoaderCircle` 与进行中文案替换原内容；不存在 `loadingText`。同一操作不要叠加第二个旋转图标。

---

### Input / Select / Checkbox / Switch

**文件位置**：`apps/web/src/shared/ui/input.tsx`、`apps/web/src/shared/ui/select.tsx`、`apps/web/src/shared/ui/checkbox.tsx`、`apps/web/src/shared/ui/switch.tsx`（均为 shadcn 生成物）

**适用场景**：表单输入、选择、错误提示、说明文字与二元设置。

```tsx
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/checkbox'
import { Switch } from '@/shared/ui/switch'

<div>
  <label htmlFor="adb-path" className="mb-2 block text-sm font-medium text-muted-foreground">ADB 路径</label>
  <Input
    id="adb-path"
    autoComplete="off"
    aria-invalid={Boolean(adbPathError)}
    aria-errormessage={adbPathError ? 'adb-path-error' : undefined}
  />
  {adbPathError && <p id="adb-path-error" role="alert" className="form-error-text">{adbPathError}</p>}
</div>

<Select items={strategyOptions} value={strategy} onValueChange={setStrategy}>
  <SelectTrigger id="strategy" className="w-full"><SelectValue /></SelectTrigger>
  <SelectContent>
    {strategyOptions.map(item => (
      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
    ))}
  </SelectContent>
</Select>

<label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
  <Checkbox checked={continueOnFailure} onCheckedChange={setContinueOnFailure} />
  <span className="transition-colors group-hover:text-primary">失败后继续下一个</span>
</label>

<label className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground">
  启用定时执行
  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label="启用定时执行" />
</label>
```

`Input`、`Select`、`Checkbox`、`Switch` 直接导入 `@/shared/ui/*`，原语不提供 `label`、`error`、`hint` 或 `hintPlacement` props。字段行由各 feature 的 field helper 组合标签、控件与错误态；说明提示使用下方 `FieldHint`，不要给原语另加说明参数。多行文本使用原生 `textarea`。

错误态给控件传 `aria-invalid`，需要与错误文本建立关联时再传 `aria-errormessage`；错误文本使用 `form-error-text`，不要在页面里单独手写红色边框。`Select` 由 Root、`SelectTrigger`、`SelectValue`、`SelectContent` 与 `SelectItem` 组合，受控值通过 `value` / `onValueChange` 传递；选项数组传给 Root 的 `items`，`SelectValue` 才能显示当前标签。

`autoComplete="off"` 是消费点（feature field helper 或直接调用处）的契约，不是 `@/shared/ui/input` 原语的默认值。配置值与搜索词在新增输入时显式关闭浏览器自动填充历史，确实需要浏览器记住输入时才改为显式传入其他值。

---

### DropdownMenu / Popover - 浮层菜单与富内容弹层

**文件位置**：`apps/web/src/shared/ui/dropdown-menu.tsx`、`apps/web/src/shared/ui/popover.tsx`（shadcn 生成物）

**适用场景**：`DropdownMenu` 用于动作列表与选项菜单（`role="menu"`）；`Popover` 用于带搜索框、说明或表单的富内容浮层（`role="dialog"`）。不要为这两类浮层手写 `fixed`/`absolute` 定位、外部点击或 Escape 监听。

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'

<Popover>
  <PopoverTrigger render={<Button variant="secondary" />}>关卡</PopoverTrigger>
  <PopoverContent
    side="bottom"
    align="start"
    sideOffset={8}
    collisionPadding={12}
    aria-label="选择关卡"
  >
    浮层内容
  </PopoverContent>
</Popover>
```

`Popover` 的 Root 默认非模态；`DropdownMenu` 的 Root 默认 `modal=true`，需要保留页面滚动与外部交互时显式传 `modal={false}`。Popup 经 Base UI portal 挂到 `document.body`，层序使用 `--layout-z-portal`，不要为浮层另写 `position: fixed` 或高位 z-index。

`side`、`align`、`sideOffset` 与 `collisionPadding` 交给 Base UI 做翻转与视口夹取；菜单内容宽度默认跟随触发器（`--anchor-width`），需要限制高度时使用 `max-h-[min(<上限>,var(--available-height))]`。触发器的 `aria-haspopup`、`aria-expanded`、`aria-controls`、Escape 回焦与方向键导航由原语提供。非模态菜单若要保留某个点击区域，在 `onOpenChange` 中对该次 outside-press 调用 `eventDetails.cancel()`，不要再注册 document 监听。

`PopoverContent` 默认带 `role="dialog"`，应传 `aria-label` 或组合 `PopoverTitle`/`PopoverDescription`；`DropdownMenuContent` 默认带 `role="menu"`，选项使用 `DropdownMenuItem`、`DropdownMenuRadioItem` 等。本仓库为生成物增加了 `collisionPadding` 透传（`PopoverContent`、`DropdownMenuContent`），其余内容保持上游原样。

---

### FieldHint - 标签说明提示

**文件位置**：`apps/web/src/shared/components/FieldHint.tsx`

**适用场景**：字段说明需要从控件下方的常驻段落收敛为标签旁的 ⓘ 提示。通过 `@/shared/components` 导入，不要在页面里重复拼装触发器。

```tsx
import { FieldHint } from '@/shared/components'

<FieldHint id="field-hint" label="难度" hint="不切换时沿用游戏内当前难度。" />
```

组件在打开时才挂载提示内容，内容带 `role="tooltip"`，触发器的 `aria-describedby` 仅在打开时指向内容 id；触发器保留 `${label}说明` 的 `aria-label`，并同时支持悬停、聚焦、点击与触屏点按。粗指针设备忽略 Base UI 合成的 hover 开关，提示由点按、点击或聚焦打开，直到 Escape、外部点按或 blur 关闭。提示内容只承载文本，使用 `pointer-events-none`，根节点设置 `disableHoverablePopup`，避免覆盖相邻控件时吞掉悬停或点击。

自定义触发器时，用 `@/shared/ui/tooltip` 组合 `Tooltip`、`TooltipTrigger`（通过 `render` 承载按钮）与 `TooltipContent`，并保持上述受控 `open`、点击/触屏打开、`role`/`aria-describedby` 与非遮挡约定。

---

### EmptyState

**文件位置**：`apps/web/src/shared/components/EmptyState.tsx`

**适用场景**：流程、列表、统计区或数据面板暂时没有内容。通过 `@/shared/components` 导入，不要在页面中各自拼装“暂无数据”的图标、文案和间距。

```tsx
import { EmptyState } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import Icons from '@/shared/components/Icons'

<EmptyState
  compact
  icon={<Icons.TrendingUp />}
  title="暂无掉落记录"
  description="执行作战并完成材料识别后，会在这里汇总掉落。"
  action={<Button variant="secondary">刷新</Button>}
/>
```

Props：

- `icon` (ReactNode) - 可选图标。
- `title` (ReactNode, required) - 空状态主文案。
- `description` (ReactNode) - 补充说明。
- `action` (ReactNode) - 可选操作，如刷新或新建。
- `compact` (boolean) - 用于卡片内部的紧凑布局，默认 `false`。
- `className` (string) - 仅在页面结构需要额外布局约束时使用。

卡片内部使用 `compact`，页面级空状态保留默认尺寸。已有自动化流程和掉落记录页使用该组件。

---

### DialogFrame / DialogBody / DialogFrameFooter

**文件位置**：`apps/web/src/shared/components/DialogFrame.tsx`

**适用场景**：需要限制在 `--layout-dialog-max-height` 内的表单、选择器与发现弹窗。`DialogFrame` 统一组合 `Dialog`、`DialogContent`、标题栏与关闭按钮，固定最大高度与各区域职责；内容通过 `DialogBody` 滚动，页脚使用 `DialogFrameFooter`。无高度上限的简单弹窗仍可直接组合生成原语。

```tsx
import { DialogBody, DialogFrame, DialogFrameFooter } from '@/shared/components'

<DialogFrame
  open={isOpen}
  onOpenChange={open => { if (!open) onClose() }}
  title="添加干员"
  size="4xl"
  footer={(
    <DialogFrameFooter align="between">
      <span>已加入 2 名干员</span>
      <Button onClick={onClose}>完成选择</Button>
    </DialogFrameFooter>
  )}
>
  <DialogBody onScroll={handleScroll}>{content}</DialogBody>
</DialogFrame>
```

`DialogFrame` 的 props：`open`、`onOpenChange`、`title`、`description`、`children`、`footer`、`layers`、`size`（`md` 为默认，另有 `lg`、`4xl`）、`closeDisabled`、`disablePointerDismissal`、`id`、`className`。`closeDisabled` 禁用标题栏关闭按钮，并拒绝 Escape、遮罩点击与关闭请求；保存或提交等待期间使用。`layers` 承载与对话框同一 Base UI root 的嵌套弹层（如发现作业中的详情抽屉），以保持 Escape 顺序与层级关系。`DialogBody` 是唯一可滚动内容区，透传原生 `div` 属性（如 `onScroll`）；`DialogFrameFooter` 透传 `div` 属性，`align` 为 `end`（默认）或 `between`。

---

### ConfirmAlertDialog / Loading

**文件位置**：`apps/web/src/shared/components/ConfirmAlertDialog.tsx`、`apps/web/src/shared/components/Loading.tsx`

**适用场景**：需要确认的破坏性操作使用 `ConfirmAlertDialog`；短时局部等待使用 `Loading`。两者都由 `shared/components` 的 `index.ts` 导出。

```tsx
import { ConfirmAlertDialog, Loading } from '@/shared/components'

{loading ? <Loading text="正在读取日志..." /> : content}
<ConfirmAlertDialog
  isOpen={confirmOpen}
  onClose={() => setConfirmOpen(false)}
  onConfirm={handleDelete}
  title="确认删除"
  message="此操作不可撤销。"
/>
```

`ConfirmAlertDialog.onConfirm` 可以返回 Promise：返回 `false` 或抛出错误时弹窗保持打开，并在弹窗内展示失败原因；确认处理中会禁用取消与确认按钮并阻止 Escape 关闭。组件内部组合 `shared/ui/alert-dialog`，初始焦点落在取消按钮。

高度受限的表单、选择器与发现弹窗使用 shared `DialogFrame` + `DialogBody` + `DialogFrameFooter`；无高度上限的简单弹窗仍可直接组合生成原语：

- `Sheet` 用于作业详情抽屉：桌面 `side="right"`、移动 `side="bottom"`；需要保留页面可交互时使用 Root 的 `modal={false}` 并自行处理外部点击关闭。
- `AlertDialog` 用于必须显式确认的操作；`role="alertdialog"` 由原语提供。
- 嵌套弹层按 React 父子关系组合（如发现弹窗内的筛选弹窗、详情抽屉上的重置确认框），Base UI 依此管理 Escape 层级、焦点归还与滚动锁。
- 弹层经 Base UI portal 挂到 `document.body`，层序使用 `--layout-z-portal`；应用自绘浮层按 [设计规范](../../DESIGN.md) 的 z-index scale 取 token，不在组件里补高位 z-index。

`DashboardSkeleton` 是控制台域内唯一的整页骨架，位于 `features/dashboard/components/DashboardSkeleton.tsx`，不属于 `shared/components` 的公共导出；`shared/components` 不提供整页骨架。

---

### UndoToastCard / AppToaster

**文件位置**：`apps/web/src/shared/components/UndoToastCard.tsx`、`apps/web/src/shared/components/AppToaster.tsx`

**适用场景**：需要「已移除 + 撤销」语义的应用级提示。`AppToaster` 在应用根挂载一次，主题跟随 `useTheme` 的解析明暗与 `lpn-ui`；提示固定在底部居中，桌面停留 24px，窄屏抬高以避开 tab bar 与安全区。`UndoToastCard` 是提示内容，默认 8 秒后自动关闭，悬停或键盘聚焦时暂停，`pending` 时禁用撤销与关闭并显示恢复中；宽度按内容收缩并居中，窄屏上限为 `calc(100vw - 2rem)`，播报由 sonner 外层 live region 承担。

```tsx
import { toast } from 'sonner'
import { AppToaster, UndoToastCard } from '@/shared/components'

// 应用根：<AppToaster />

toast.custom(() => (
  <UndoToastCard
    message="已移除 阿米娅"
    pending={false}
    onUndo={handleUndo}
    onDismiss={handleDismiss}
  />
), { id: 'undo-toast', duration: Infinity, dismissible: false })
```

使用 `toast.custom` 时让卡片自己管理 8 秒计时与暂停，因此传入 `duration: Infinity`；关闭按钮与撤销动作由卡片提供，因此传入 `dismissible: false`。同一提示复用稳定 id，避免重复堆叠。

---

### Notifications - 全局通知

**文件位置**：`apps/web/src/shared/notifications/notify.ts`；渲染由应用根挂载的 `AppToaster`（sonner）承担。

**适用场景**：跨页面结果、错误和执行进度提示。统一从 `@/shared/notifications` 导入，不要在页面里直接调用 sonner 或自建 toast。

```typescript
notify(message: string, type?: 'success' | 'error' | 'warning' | 'info' | 'default', options?: {
  id?: string
  duration?: number
  description?: string
  action?: { label: string; onClick: () => void }
}): string

notifyProgress(message: string, id: string): string

dismissNotice(id?: string): void
```

同一流程复用固定 id，后续更新会替换原通知而不是堆叠。固定 id：`execution`（自动化、作业、肉鸽与 Dashboard 执行）、`statistics`（识别与材料）、`settings-update`（组件更新）、`settings-update-channel`（更新渠道保存）、`settings-auto-update`（自动更新保存）、`settings-config:connection` / `settings-config:instance` / `settings-config:resource-source`（设置草稿保存）、`combat-preview`（作业预览）、`combat-queue-preview`（搜索作业加入队列）、`combat-paradox-search`（悖论模拟搜索）、`dashboard-connection`（概览连接告警）。开始用 `notifyProgress(message, id)`；有终态文案时用同一 id 的 `notify(..., { id })` 替换；没有终态文案时才 `dismissNotice(id)` 收起进度。不传 `type` 时按文案推断；错误默认常驻到用户关闭，成功默认约 2.5 秒，警告与信息默认约 4 秒。`duration` 可显式覆盖，进度通知默认不自动消失。`description` 与 `action` 原样传给 sonner，只用于需要补充说明或内联动作的通知。应用最多同时显示 3 条通知；`AppToaster` 为每条通知提供关闭按钮（无障碍名称「关闭通知」）。

概览的连接告警使用常驻 toast：`offline` 时以固定 id `dashboard-connection` 发送 warning 与 `description`，不附带 action；`unavailable` 时发送 error、`description` 与「重试连接」action。连接恢复自动 `dismissNotice`；toast 由应用根渲染，不参与页面布局。

---

### Icons

**文件位置**：`apps/web/src/shared/components/Icons.tsx`

**适用场景**：业务身份与概览图标。组件以默认对象导出，页面从 `@/shared/components/Icons` 导入后按名称使用；普通功能图标优先使用 `lucide-react`，不要在页面重复手写 SVG。

```tsx
import Icons from '@/shared/components/Icons'

<Icons.TrendingUp />
```

业务身份图标（Play、Sword、Gift 等）自带 `icon-well` 身份底座，只用于页面、概览和卡片的内容身份，不能包裹普通按钮图标；`TrendingUp`、`Zap`、`Star`、`RefreshCw`、`Crosshair` 等概览/内联图标是裸 SVG。装饰图标加 `aria-hidden="true"`；状态与结果同时提供可读文字或 `aria-label`。

---

### useFluidTabIndicator

**文件位置**：`apps/web/src/shared/hooks/useFluidTabIndicator.ts`

**适用场景**：已有自定义分段按钮组需要复用高亮矩形测量与 roving focus 键盘处理时使用。页面级分段导航统一使用 `SegmentedTabs` / `SegmentedTabNav`，其内部复用本 Hook 的测量逻辑；不要在新页面复制 `ResizeObserver`、元素 ref 和坐标计算。

```tsx
const { containerRef, activeRect, setTabRef, handleTabKeyDown } = useFluidTabIndicator(activeTab)
```

Hook 返回高亮容器 ref、当前高亮矩形、标签 ref 设置器与方向键/Home/End 处理函数，并在切换、容器尺寸变化、标签内容变化和窗口缩放时重新测量。标签 ID 需是字符串联合类型，且高亮容器需要 `relative` 定位。当前只有 `OperatorPicker` 的干员范围分段直接使用；页面导航应改用共享的 `SegmentedTabNav`。

---

## 组件接入

页面标题由 `Layout` 顶栏统一提供，页面不接收标题、副标题或页头操作。新增页面或改老页面时，按下面顺序处理：

1. 页面根使用 `PageShell`；它提供 `app-stack-section` 承载内容，页面内容直接进入工作区。
2. 大面板使用 `Card` 组合；分节自持内边距时给 `Card` 加 `gap-0 p-0!`。
3. 表单使用 `@/shared/ui` 的 `Input`、`Select`、`Checkbox`、`Switch` 原语，并用所属 feature 的 field helper 组合标签与错误；多行文本使用原生 `textarea`。
4. 没有内容时使用 `EmptyState`，不要重复手写空状态。
5. 页面级分段导航使用 `SegmentedTabs` + `SegmentedTabNav` + `SegmentedTabPanel`；表单内单值分段使用 `SegmentedControl`。不要复制测量逻辑，也不要自建 tablist。
6. 全局执行结果、错误与进度使用 `notify` / `notifyProgress`；局部状态使用既有 `status-*` 语义类并紧邻相关操作。
7. 操作用 `@/shared/ui/button` 的 `Button`；无文字操作使用 `size="icon"` 档位并同时提供 `title` 与 `aria-label`。
8. 如果出现新的颜色、圆角、间距需求，先按根目录 [设计规范](../../DESIGN.md) 判断是否应抽成 token 或语义类。

### Tailwind 动态类名

Tailwind CSS 不支持动态拼接类名：

```tsx
// 不要这样写
className={`bg-${color}`}
className={`from-${tone}`}
```

需要按状态切换样式时，使用明确的 class 映射，或优先使用已有语义类。
