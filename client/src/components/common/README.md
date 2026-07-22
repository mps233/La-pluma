# 通用组件库

本目录包含项目中可复用的通用 UI 组件，用于统一代码风格和减少重复代码。组件通过 `index.ts` 统一导出，页面中优先从 `@/components/common` 或相邻路径的 `./common` 引入。

项目级设计规范见根目录 `COMPONENT_LIBRARY_GUIDE.md`。本文件保留日常开发最常用的规则和组件用法。

## 原生运行时约定

应用由 `Layout` 和 common 组件使用原生语义元素提供页面 chrome。`Button`、`Card`、`Loading`、`ActivityIndicator`、`Switch` 等组件在浏览器、jsdom、SSR 和嵌入式渲染中使用同一套 DOM 与行为；不要按运行环境维护第二套实现。

主题由 `useUIStore` 统一管理并同步到文档根节点与 `.la-pluma-app`。Navbar 和移动 tabbar 的安全区由 `Layout` 及统一 token 管理；只有不属于应用 chrome 的自定义固定浮层才补充 `env(safe-area-inset-*)`，避免重复 padding。桌面侧栏和移动悬浮胶囊导航由 `Layout` 统一提供，页面只负责渲染内容。

## 设计系统速记

### 色彩

页面不要再按模块自定义主色。新增 UI 优先使用语义类：

- `surface-panel` / `surface-soft`：卡片、面板、弱背景。
- `control-surface` / `control-active`：输入、筛选、分段按钮。
- `brand-action` / `brand-text`：主要操作和品牌强调。
- `status-success` / `status-warning` / `status-danger` / `status-info`：语义状态提示。
- `status-success-action` / `status-danger-action`：成功、危险操作按钮。
- `form-error-surface` / `form-error-text`：表单错误态。

不要新增页面级 `from-violet-*`、`bg-orange-*`、`text-cyan-*` 这类独立主题色。需要新语义时，先在 `client/src/index.css` 增加 token 或语义类。

### 文字与交互

- 页面标题使用 `PageHeader`；常规卡片标题使用 `text-lg font-semibold`；字段标题和正文使用 `text-sm`；说明、标签和元数据使用 `text-xs text-tertiary`。
- 多行正文使用 `leading-6` 或 `leading-relaxed`；普通中文文本不要新增 letter spacing，也不要在普通页面新建 `8px` 至 `11px` 微文案。
- 可点击元素优先使用 `Button`、`IconButton`、`control-surface` 或 `surface-panel-hover`，并保留 `focus-visible`。静态卡片不添加 hover 位移或投影；禁用与 loading 状态必须关闭交互，不能只降低透明度。
- 普通 hover 只做轻微压暗、弱主题背景或 1px 描边；不要新增高亮渐变、重投影或无意义缩放。新增动效应尊重 reduced motion。
- 启动、连接或执行中的重点区域可使用 `status-border-beam is-active` 提供短暂的主题色边框反馈；空闲后移除 `is-active`，不要用于普通静态卡片。

### 反馈、图标与布局

- 字段问题用表单组件的 `error`；控制台仅在首次且没有会话缓存时由 `DashboardSkeleton` 维持结构，返回页面应保留旧内容并后台刷新；局部加载用 `Loading`；无数据用 `EmptyState`；不可逆操作用 `ConfirmDialog`。区域错误必须就地展示和重试，不要伪装成空状态。
- 全局结果使用 `useStatusStore.setMessage` 和 `FloatingStatusIndicator`。错误持续到用户关闭，其他短消息由 store 自动收起；不要新增独立 toast 或自行清除定时器。
- 普通功能图标优先用 `lucide-react`，业务身份图标复用 `Icons`。无文字操作用 `IconButton` 并同时提供 `title` 与 `aria-label`；装饰图标加 `aria-hidden`。
- 应用外层使用 `app-shell` 控制 1600px 最大宽度与响应式 gutter；页面内容使用 `app-page`，复用控制台手机材质的功能页在同层增加 `ios-workspace-page`，区块用 `app-stack-section`，卡片内用 `app-stack-card`。页面内部不要再嵌套 `max-w-7xl` 或重复水平 padding。不要为凑版式嵌套卡片或硬塞多栏；每列保持 `min-w-0`，窄屏优先折叠。

### 圆角与间距

圆角和常用间距已经接入 `client/tailwind.config.js`：

- `rounded-xl` / `rounded-2xl` / `rounded-3xl` 统一映射到 `--app-radius-lg`。
- `gap-3` / `gap-4` 和 `space-y-4` 映射到 `--app-space-card`。
- `gap-5` / `gap-6` 和 `space-y-5` / `space-y-6` 映射到 `--app-space-section`。

通用间距遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 依次为 4、8、12、16、20、24px。页面、卡片、输入控件和按钮分别使用 `--app-space-page`、`--app-space-panel`、`--app-space-control-x` 与 `app-button-size-*`。iOS 风格按钮档位为 36/44/48px，输入与选择框为 44px；手机和粗指针设备的标准交互区均不得小于 44px。不要在调用处覆盖标准控件的 `h-*`、`px-*`、`py-*` 来缩小点击区。

页面布局优先使用：

- `app-page`：页面外层 padding。
- `app-stack-section`：页面区块纵向间距。
- `app-stack-card`：卡片内部或紧密内容纵向间距。
- `app-grid-section`：主区块网格间距。
- `app-grid-card`：卡片网格间距。

### 边框

卡片、输入、分段控件和普通信息容器统一使用 `1px` 可见边框，颜色使用 `--app-border`；需要增强分隔时使用 `--app-border-strong`。不要在页面里把普通容器改成 `border-2` 或重新定义描边颜色。

`2px` 仅保留给复选框、层级引导线、加载圈等非容器或小尺寸结构；焦点环、阴影不属于边框规范。

### 卡片与表单

能用组件时优先用组件；特殊结构再使用语义类。

- 卡片：`Card`、`CardHeader`、`CardContent`、`InfoCard`，或 `app-card surface-panel`。
- 按钮：`Button`、`IconButton`，或 `app-button` / `app-icon-button`。
- 输入：`Input`、`Select`、`Checkbox`、`Switch`，或 `app-input control-surface`；多行文本使用同一语义类的原生 `textarea`。

移动端间距由 token 自动收缩，不要再用全局 `.p-4`、`.p-6` 覆盖来修页面。

页面按 mobile-first 编写：`sm` (640px) 恢复次级信息或横向工具栏，`md` (768px) 适配中宽布局，`lg` (1024px) 与 `xl` (1280px) 再扩展为多栏。窄屏优先折叠列、让操作全宽或换行，不裁剪有效内容；不要为新页面增加非标准断点。

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
- `animated` (boolean) - 是否启用动画，默认 `true`
- `mobileLayout` (`stack` | `inline`) - 手机端操作布局；默认 `stack`，仅标题和操作足够紧凑时使用 `inline`

页面标题统一使用全局品牌色，不再按页面传入独立渐变。

---

### Card - 卡片组件

统一的卡片容器样式，支持动画和自定义样式。

```tsx
import { Card, CardHeader, CardContent, InfoCard } from '@/components/common'

<Card animated delay={0.1}>
  <CardHeader
    icon={<Icons.Package />}
    title="材料掉落统计"
    actions={<button>刷新</button>}
  />
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
</Card>

<InfoCard type="warning">
  <p>需要用户注意的信息。</p>
</InfoCard>
```

Card Props：

- `children` (ReactNode, required) - 卡片内容
- `className` (string) - 额外类名
- `animated` (boolean) - 是否启用动画，默认 `true`
- `delay` (number) - 动画延迟，默认 `0`
- `smoothCorners` (boolean) - 使用 Lisse 连续曲率；仅在内容允许增加内部表面层时显式开启，外层继续承担布局、动画和阴影

`CardHeader` 支持 `icon`、`title`、`actions`；`CardContent` 和 `InfoCard` 均支持 `className`。

需要让非 `Card` 面板使用同一连续曲率时，优先使用 `SmoothPanel`。它由未裁切的阴影外壳和 Lisse 内表面组成；常规面板为 `20px / 80%`，短小信息卡传入 `cornerSize="compact"` 使用 `16px / 80%`。只有本身没有外阴影的圆角矩形才直接使用 `SmoothSurface`，因为它的 `clip-path` 会裁掉外阴影。

`ios-workspace-page` 只提升显式开启连续圆角的一级 `Card` / `SmoothPanel`；卡内 `surface-soft`、菜单、输入和高密度列表项保持普通圆角。一级工作区标题与控制台一致，不添加装饰图标，并显式使用 `mobileLayout="inline"`；长状态由 `FloatingStatusIndicator` 在右侧截断。

---

### Button / IconButton - 按钮组件

统一按钮样式，支持主要、次要、危险、成功、幽灵等变体。

```tsx
import { Button, IconButton } from '@/components/common'

<Button variant="primary" icon={<Icons.SaveIcon />}>保存</Button>
<Button variant="danger" loading={deleting}>删除</Button>
<IconButton icon={<Icons.RefreshIcon />} title="刷新" />
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

### ConfirmDialog / Loading / ActivityIndicator - 反馈组件

`ConfirmDialog`、`Loading` 和 `ActivityIndicator` 从 common 导出。

- `ConfirmDialog`：删除、清空等不可逆操作的确认弹窗。异步 `onConfirm` 返回 `false` 或抛出错误时会保持打开并就地显示失败原因。
- `Loading`：短时局部等待状态。
- `ActivityIndicator`：按钮或紧凑状态行中的 iOS 活动指示器，支持 `xs`、`sm`、`md`、`lg` 四档；同一区域只保留一个动态指示器。
- `DashboardSkeleton`：控制台专用骨架，由 `Dashboard` 直接从 `Loading.tsx` 引入，不属于 common 的公共导出。

## 重构建议

新增或整理页面时按这个顺序做：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 或 `app-card surface-panel`。
4. 表单使用 `Input`、`Select`、`Checkbox`；多行文本复用 `app-input control-surface`。
5. 没有内容时使用 `EmptyState`，不要新增孤立的空态样式。
6. 页面全局执行状态使用 `FloatingStatusIndicator`；局部状态使用既有 `status-*` 语义类并紧邻相关操作。
7. 操作用 `Button`、`IconButton`。
8. 新颜色、新圆角、新间距优先抽为 token 或语义类。

## 下一步计划

1. ✅ 创建通用组件。
2. ✅ 接入统一色彩、圆角、间距 token。
3. ✅ Button、Input、ConfirmDialog、Loading 等组件纳入 common。
4. ⏳ 持续把零散手写卡片迁移到 `Card` 或 `app-card`。
5. ⏳ 为核心通用组件补充单元测试或视觉回归检查。

---

**创建时间**：2026-02-09
**最后更新**：2026-07-11
**维护者**：@mps233
