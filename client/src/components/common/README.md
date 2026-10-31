# 通用组件库

本目录包含项目中可复用的通用 UI 组件，用于统一代码风格和减少重复代码。组件通过 `index.ts` 统一导出，页面中优先从 `@/components/common` 或相邻路径的 `./common` 引入。

项目级设计规范见根目录 `COMPONENT_LIBRARY_GUIDE.md`。本文件保留日常开发最常用的规则和组件用法。

## 原生运行时约定

应用由 `Layout` 和 common 组件使用原生语义元素提供页面 chrome。`Button`、`Card`、`Loading`、`ActivityIndicator`、`Switch` 等组件在浏览器、jsdom、SSR 和嵌入式渲染中使用同一套 DOM 与行为；不要按运行环境维护第二套实现。

主题由 `useUIStore` 统一管理并同步到文档根节点与 `.la-pluma-app`。Navbar 和移动 tabbar 的安全区由 `Layout` 及统一 token 管理；只有不属于应用 chrome 的自定义固定浮层才补充 `env(safe-area-inset-*)`，避免重复 padding。桌面侧栏和移动悬浮胶囊导航由 `Layout` 统一提供，页面只负责渲染内容。

## 设计规范

色彩、文字层级、圆角、间距、边框、阴影、交互状态、响应式断点等视觉规范统一由根目录 `COMPONENT_LIBRARY_GUIDE.md` 维护。本文件只记录组件 API 和本目录的运行时约定；需要修改规范时改指南，不要在这里另写一份。

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

页面标题统一使用全局品牌色，不再按页面传入独立渐变。

---

### Card - 卡片组件

统一的卡片容器样式，支持连续圆角和自定义样式。静态卡片直接渲染，不使用整卡进场动画。

```tsx
import { Card, CardHeader, CardContent } from '@/components/common'

<Card smoothCorners>
  <CardHeader
    icon={<Icons.Package />}
    title="材料掉落统计"
    actions={<button>刷新</button>}
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

需要让非 `Card` 面板使用同一连续曲率时，优先使用 `SmoothPanel`。它由未裁切的阴影外壳和 Lisse 内表面组成；常规面板为 `20px / 80%`，短小信息卡传入 `cornerSize="compact"` 使用 `16px / 80%`。只有本身没有外阴影的圆角矩形才直接使用 `SmoothSurface`，因为它的 `clip-path` 会裁掉外阴影。

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

`IconButton` 仅支持 `primary`、`secondary`、`danger`、`ghost`。

`Button` 的 loading 状态会显示紧凑的 iOS 活动指示器并保留 `loadingText`。页面不要再给同一操作叠加第二个旋转图标。

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

<Switch
  label="启用定时执行"
  checked={scheduleEnabled}
  onChange={setScheduleEnabled}
/>
```

表单错误态使用 `error` prop，不要在页面里单独手写红色边框和错误文字。`Input`、`Select` 均支持 `hint`；`Input` 额外支持前置 `icon`。二元设置使用 `Switch`，多选或参数组合使用 `Checkbox`；多行文本使用带 `app-input control-surface` 的原生 `textarea`。

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

### ConfirmDialog / Loading - 反馈组件

`ConfirmDialog` 和 `Loading` 从 common 导出。

- `ConfirmDialog`：删除、清空等不可逆操作的确认弹窗。异步 `onConfirm` 返回 `false` 或抛出错误时会保持打开并就地显示失败原因。
- `Loading`：短时局部等待状态。
- `ActivityIndicator`：供 `Button` 和 `Loading` 内部复用的 iOS 活动指示器；页面不要直接调用或叠加第二个动态指示器。
- `DashboardSkeleton`：控制台专用骨架，由 `Dashboard` 直接从 `Loading.tsx` 引入，不属于 common 的公共导出。

## 新增页面顺序

页面结构、组件选型和重构顺序见 `COMPONENT_LIBRARY_GUIDE.md` 的「重构建议」，本文件不再重复该清单。

---

**创建时间**：2026-02-09
**最后更新**：2026-11-01
**维护者**：@mps233
