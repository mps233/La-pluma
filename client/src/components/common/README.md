# 通用组件库

本目录包含项目中可复用的通用 UI 组件，用于统一代码风格和减少重复代码。组件通过 `index.ts` 统一导出，页面中优先从 `@/components/common` 或相邻路径的 `./common` 引入。

项目级设计规范见根目录 `COMPONENT_LIBRARY_GUIDE.md`。本文件保留日常开发最常用的规则和组件用法。

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
- 可点击元素优先使用 `Button`、`IconButton`、`control-surface` 或 `surface-panel-hover`，并保留 `focus-visible`。禁用与 loading 状态必须关闭交互，不能只降低透明度。
- 普通 hover 只做轻微压暗、弱主题背景或 1px 描边；不要新增高亮渐变、重投影或无意义缩放。新增动效应尊重 reduced motion。

### 反馈、图标与布局

- 字段问题用表单组件的 `error`；已知结构加载用 `Skeleton`；局部加载用 `Loading`；无数据用 `EmptyState`；不可逆操作用 `ConfirmDialog`。区域错误必须就地展示和重试，不要伪装成空状态。
- 全局短消息使用 `useStatusStore.setMessage` 和 `FloatingStatusIndicator`，不要新增独立 toast 或自行清除定时器。
- 普通功能图标优先用 `lucide-react`，业务身份图标复用 `Icons`。无文字操作用 `IconButton` 并同时提供 `title` 与 `aria-label`；装饰图标加 `aria-hidden`。
- 页面内容使用既有 `max-w-7xl` 与 `app-page`，区块用 `app-stack-section`，卡片内用 `app-stack-card`。不要为凑版式嵌套卡片或硬塞多栏；每列保持 `min-w-0`，窄屏优先折叠。

### 圆角与间距

圆角和常用间距已经接入 `client/tailwind.config.js`：

- `rounded-xl` / `rounded-2xl` / `rounded-3xl` 统一映射到 `--app-radius-lg`。
- `gap-3` / `gap-4` 和 `space-y-4` 映射到 `--app-space-card`。
- `gap-5` / `gap-6` 和 `space-y-5` / `space-y-6` 映射到 `--app-space-section`。

通用间距遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 依次为 4、8、12、16、20、24px。页面、卡片、输入控件和按钮分别使用 `--app-space-page`、`--app-space-panel`、`--app-space-control-*` 与 `app-button-size-*`，不要在调用处覆盖标准控件的 `px-*`、`py-*`。

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
- 输入：`Input`、`Textarea`、`Select`、`Checkbox`，或 `app-input control-surface`。

移动端间距由 token 自动收缩，不要再用全局 `.p-4`、`.p-6` 覆盖来修页面。

页面按 mobile-first 编写：`sm` (640px) 恢复次级信息或横向工具栏，`md` (768px) 适配中宽布局，`lg` (1024px) 与 `xl` (1280px) 再扩展为多栏。窄屏优先折叠列、让操作全宽或换行，不裁剪有效内容；不要为新页面增加非标准断点。

## 组件列表

### PageHeader - 页面标题组件

统一的页面标题样式，包含图标、标题、副标题和操作区域。

```tsx
import { PageHeader, StatusIndicator } from '@/components/common'
import Icons from '../Icons'

<PageHeader
  icon={<Icons.TargetIcon />}
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
/>

<PageHeader
  icon={<Icons.CogIcon />}
  title="配置管理"
  subtitle="管理 MAA CLI 连接和运行配置"
  actions={
    <StatusIndicator
      isActive={loading}
      activeText="处理中"
      inactiveText="就绪"
    />
  }
/>
```

Props：

- `icon` (ReactNode) - 图标组件
- `title` (string, required) - 主标题
- `subtitle` (string) - 副标题
- `actions` (ReactNode) - 右侧操作区域
- `animated` (boolean) - 是否启用动画，默认 `true`

页面标题统一使用全局品牌色，不再按页面传入独立渐变。

---

### StatusIndicator - 状态指示器组件

统一的状态显示样式，包含动画圆点和状态文本。

```tsx
import { StatusIndicator } from '@/components/common'

<StatusIndicator
  isActive={isRunning}
  activeText="运行中"
  inactiveText="就绪"
/>

<StatusIndicator
  isActive={true}
  message={message || '等待任务'}
  type="info"
/>
```

Props：

- `isActive` (boolean) - 是否处于活动状态，默认 `false`
- `activeText` (string) - 活动状态文本，默认 `运行中`
- `inactiveText` (string) - 非活动状态文本，默认 `就绪`
- `message` (string) - 自定义消息，优先级高于 `activeText` / `inactiveText`
- `type` ('success' | 'error' | 'warning' | 'info' | 'default') - 状态语义
- `activeColor` / `inactiveColor` - 旧调用兼容参数，新代码不再推荐使用

页面级、会跟随滚动悬浮的执行状态使用 `../FloatingStatusIndicator`；`StatusIndicator` 只用于卡片或表单中的局部静态状态。

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
- `hover` (boolean) - 是否启用悬停效果，默认 `false`
- `theme` - 旧调用兼容参数。所有值当前均使用同一套主题表面，新代码不要用它区分模块配色。

`CardHeader` 支持 `icon`、`title`、`actions`；`CardContent` 和 `InfoCard` 均支持 `className`。

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
- `gradient`：保留的主要操作兼容别名，新代码使用 `primary`

`IconButton` 仅支持 `primary`、`secondary`、`danger`、`ghost`；没有 `success`、`outline` 或 `gradient` 变体。

---

### Input / Textarea / Select / Checkbox - 表单组件

统一输入、选择、错误和提示样式。

```tsx
import { Input, Select, Checkbox } from '@/components/common'

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
```

表单错误态使用 `error` prop，不要在页面里单独手写红色边框和错误文字。`Input`、`Textarea`、`Select` 均支持 `hint`；`Input` 额外支持前置 `icon`。`Checkbox.color` 是历史兼容参数，新代码不要按页面传入不同颜色。

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

### Modal / ConfirmDialog / Loading - 反馈组件

`Modal`、`ConfirmDialog`、`Loading`、`FullScreenLoading`、`Skeleton`、`CardSkeleton`、`DashboardSkeleton` 均从 common 导出。

- `Modal` / `ConfirmDialog`：需要阻断或确认用户操作时使用；优先传入明确的 `title`、`footer` 和关闭行为。
- `Loading` / `FullScreenLoading`：短时局部或全屏等待状态。
- `Skeleton` / `CardSkeleton` / `DashboardSkeleton`：初次加载时保留内容结构，避免布局跳动。控制台使用 `DashboardSkeleton`，不要另行复制其布局。

## 重构建议

新增或整理页面时按这个顺序做：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 或 `app-card surface-panel`。
4. 表单使用 `Input`、`Textarea`、`Select`、`Checkbox`。
5. 没有内容时使用 `EmptyState`，不要新增孤立的空态样式。
6. 页面全局执行状态使用 `FloatingStatusIndicator`；局部静态状态才使用 `StatusIndicator`。
7. 操作用 `Button`、`IconButton`。
8. 新颜色、新圆角、新间距优先抽为 token 或语义类。

## 下一步计划

1. ✅ 创建通用组件。
2. ✅ 接入统一色彩、圆角、间距 token。
3. ✅ Button、Input、Modal、Loading 等组件纳入 common。
4. ⏳ 持续把零散手写卡片迁移到 `Card` 或 `app-card`。
5. ⏳ 为核心通用组件补充单元测试或视觉回归检查。

---

**创建时间**：2026-02-09
**最后更新**：2026-07-11
**维护者**：@mps233
