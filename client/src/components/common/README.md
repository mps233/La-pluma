# 通用组件库

本目录包含项目中可复用的通用 UI 组件，用于统一代码风格和减少重复代码。组件通过 `index.ts` 统一导出，页面中优先从 `@/components/common` 或相邻路径的 `./common` 引入。

项目级设计规范见根目录 `DESIGN.md`。本文件保留日常开发最常用的规则和组件用法。

## 原生运行时约定

`Button`、`Card`、`Loading`、`ActivityIndicator`、`Switch` 等组件在浏览器、jsdom、SSR 和嵌入式渲染中使用同一套原生语义 DOM 与行为；不要按运行环境维护第二套实现。壳层、安全区和主题归属见 `DESIGN.md`。

## 设计规范

色彩、文字层级、圆角、间距、边框、阴影、交互状态、响应式断点等视觉规范统一由根目录 `DESIGN.md` 维护。本文件只记录组件 API 和本目录的运行时约定；需要修改规范时改指南，不要在这里另写一份。

组件本身不携带主题分支，颜色和尺寸一律通过 `app-*` 语义类与 `--app-*` token 取得，因此同一份 DOM 在浅色、深色和嵌入式渲染下表现一致。

## 组件列表

### PageHeader - 页面标题组件

统一的页面标题样式，包含标题、副标题和操作区域；`icon` 仅用于确有身份识别需要的独立页面。

```tsx
import { PageHeader } from '@/components/common'
import FloatingStatusIndicator from '@/components/FloatingStatusIndicator'

<PageHeader
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
  mobileLayout="inline"
  actions={<FloatingStatusIndicator />}
/>
```

Props：

- `icon` (ReactNode) - 图标组件
- `title` (string, required) - 主标题
- `subtitle` (string) - 副标题
- `actions` (ReactNode) - 右侧操作区域
- `mobileLayout` (`stack` | `inline`) - 手机端操作布局；默认 `stack`，仅标题和操作足够紧凑时使用 `inline`

页面标题使用 `--app-text`（`text-primary`），不要在页面里传入渐变色或品牌色。

---

### Card - 卡片组件

统一的卡片容器样式，支持连续圆角和自定义样式。静态卡片直接渲染，不使用整卡进场动画。

```tsx
import { Card, CardHeader, CardContent, Button } from '@/components/common'

<Card smoothCorners className="!p-0">
  <CardHeader
    icon={<Icons.Package />}
    title="材料掉落统计"
    actions={<Button variant="ghost" size="sm">刷新</Button>}
  />
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
</Card>

```

Card Props：

- `children` (ReactNode, required) - 卡片内容
- `className` (string) - 额外类名
- `smoothCorners` (boolean) - 使用 Lisse 连续曲率；仅在内容允许增加内部表面层时显式开启，外层继续承担布局和阴影

`CardHeader` 支持 `icon`、`title`、`actions`；`CardContent` 支持 `className`。

需要让非 `Card` 面板使用同一连续曲率时，优先使用 `SmoothPanel`。它由未裁切的阴影外壳和 Lisse 内表面组成；常规面板为 `20px / 80%`，短小信息卡传入 `cornerSize="compact"` 使用 `16px / 80%`。只有本身没有外阴影的圆角矩形才直接使用 `SmoothSurface`（从 `@/components/common/SmoothSurface` 直接导入；它不是 barrel 导出），因为它的 `clip-path` 会裁掉外阴影。

`ios-workspace-page` 只提升显式开启连续圆角的一级 `Card` / `SmoothPanel`；卡内 `surface-soft`、菜单、输入和高密度列表项保持普通圆角。一级工作区标题与控制台一致，不添加装饰图标，并显式使用 `mobileLayout="inline"`；长状态由 `FloatingStatusIndicator` 在右侧截断。

---

### Button / IconButton - 按钮组件

统一按钮样式，支持主要、次要、危险、成功、幽灵等变体。

```tsx
import { Button, IconButton } from '@/components/common'
import { RefreshCw, Save } from 'lucide-react'

<Button variant="primary" icon={<Save />}>保存</Button>
<Button variant="danger" loading={deleting}>删除</Button>
<IconButton icon={<RefreshCw />} title="刷新" />
```

`Button` 变体：

- `primary`：主要操作
- `secondary` / `outline`：次级操作
- `success`：成功或确认类操作
- `danger`：危险操作
- `ghost`：低强调操作

`IconButton` 仅支持 `primary`、`secondary`、`danger`、`ghost`。默认使用原生 `title` 作为悬停提示；需要统一的自定义提示样式时传入 `tooltip`（可选 `tooltipSide="top" | "bottom"`）。`tooltip` 只负责视觉提示，`title` 或 `aria-label` 仍必须提供，组件会用它们生成无障碍名称。

`Button` 的 loading 状态会显示紧凑的 iOS 活动指示器并保留 `loadingText`。页面不要再给同一操作叠加第二个旋转图标。

---

### Tooltip - 轻量提示

用于图标工具条等没有可见文字的控件。触发元素必须自带 `aria-label`；Tooltip 只是视觉补充，不是唯一的无障碍名称来源。不要给拖拽手柄或破坏性操作加长按提示。

```tsx
import { Tooltip } from '@/components/common'

<Tooltip content="全屏">
  <button type="button" aria-label="全屏">...</button>
</Tooltip>
```

Props：

- `content` (ReactNode, required) - 提示内容。
- `children` (ReactElement, required) - 触发元素，建议是原生 `button` 或 `IconButton`。
- `side` (`top` | `bottom`) - 首选方向；空间不足时自动翻转。
- `delay` (number) - 首次悬停延迟，默认 `400`ms。
- `warmWindow` (number) - 关闭后继续暖显示的窗口，默认 `400`ms。
- `longPress` (number) - 触摸长按打开时间，默认 `450`ms。
- `disabled` (boolean) - 关闭提示。
- `className` (string) - 追加到提示气泡的类名。

鼠标悬停、键盘焦点和触摸长按都可以打开；Escape、外部点击、滚动或窗口缩放会关闭。提供 `tooltip` 时不要再保留同一个元素的 `title`，避免原生提示和自定义提示叠加。

---

### StatusMark - 环形任务状态

用于作业、任务行等需要表达「待执行 / 执行中 / 已完成 / 待重试 / 已跳过」的场景。组件来源于 ReactBits 的 `StatusMark`，仅将动画导入改为项目已有的 `framer-motion`，状态文案改为中文；视觉和状态机保持原样。

```tsx
import { StatusMark } from '@/components/common'

<StatusMark
  status="running"
  label="执行中"
  size={16}
  fontSize={11}
  color="var(--app-accent)"
  doneColor="var(--app-success)"
  errorColor="var(--app-danger)"
/>
```

- `status`：`pending` / `running` / `done` / `failed` / `cancelled`。
- `progress`：仅 `running` 时使用，传入 0–1 的确定进度；不传则为不确定进度弧。
- `label`：环右侧的可读状态文字；不要只靠环的颜色或形状表达状态。
- `size` / `fontSize` / `strokeWidth`：按所在行密度调整；列表行建议 16px 环配 11px 文字。
- `color` / `doneColor` / `errorColor`：优先传语义 token，如 `var(--app-accent)`、`var(--app-success)`、`var(--app-danger)`。
- `strike`：完成态是否给 `label` 加删除线，默认 `true`；状态文字本身不适合删除线时可传 `false`。

StatusMark 是纯展示组件，不能替代可交互的勾选框；选择状态仍使用原生按钮/复选框。

---

### Input / Select / Checkbox / Switch - 表单组件

统一输入、选择、错误和提示样式。

```tsx
import { Input, Select, Checkbox, Switch } from '@/components/common'

<Input
  label="ADB 路径"
  value={adbPath}
  onChange={setAdbPath}
  error={adbPathError}
/>

<Select
  label="队列策略"
  value={strategy}
  onChange={setStrategy}
  options={strategyOptions}
/>

<Checkbox
  label="失败后继续下一个"
  checked={continueOnFailure}
  onChange={setContinueOnFailure}
/>

<div className="flex items-center justify-between gap-4">
  <div>
    <label htmlFor="schedule-enabled" className="text-sm font-medium text-primary">启用定时执行</label>
    <p className="text-xs text-tertiary">每天按设定时间执行</p>
  </div>
  <Switch
    id="schedule-enabled"
    label="启用定时执行"
    checked={scheduleEnabled}
    onChange={setScheduleEnabled}
  />
</div>
```

表单错误态使用 `error` prop，不要在页面里单独手写红色边框和错误文字。`Input`、`Select` 均支持 `hint`；`Input` 额外支持前置 `icon`。二元设置使用 `Switch`，多选或参数组合使用 `Checkbox`；多行文本使用带 `app-input control-surface !h-auto !min-h-28 resize-y px-3 py-2` 的原生 `textarea`（`app-input` 在手机端会被 44px 的 `!important` 高度规则覆盖）。

---

### EmptyState - 空状态组件

列表、流程或数据区没有内容时，使用 `EmptyState` 保持图标、层级、间距和操作入口一致。不要在页面里重复手写“暂无数据”容器。

```tsx
import { EmptyState, Button } from '@/components/common'
import Icons from '../Icons'

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

---

### Modal / ConfirmDialog - 覆盖层

`Modal` 和 `ConfirmDialog` 从 common 导出。`Modal` 用于 ≤6 字段的短表单：`size` 为 `sm` / `md` / `lg` / `xl`（max-width 28 / 32 / 42 / 56rem），内置焦点陷阱、关闭归还、滚动锁和背景 inert。`Sheet` 是 `Layout` 的移动导航内部组件，不是公共导出。

- `ConfirmDialog`：删除、清空等不可逆操作的确认弹窗。异步 `onConfirm` 返回 `false` 或抛出错误时会保持打开并就地显示失败原因。

### Loading - 反馈组件

`Loading` 从 common 导出。

- `Loading`：短时局部等待状态。
- `ActivityIndicator`：供 `Button` 和 `Loading` 内部复用的 iOS 活动指示器；页面不要直接调用或叠加第二个动态指示器。
- `DashboardSkeleton`：控制台专用骨架，由 `Dashboard` 直接从 `Loading.tsx` 引入，不属于 common 的公共导出。

## 新增页面顺序

页面结构、组件选型和重构顺序见 `DESIGN.md` 的「重构建议」，本文件不再重复该清单。

---

**创建时间**：2026-02-09
**最后更新**：2026-11-01
**维护者**：@mps233
