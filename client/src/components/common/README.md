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

### 圆角与间距

圆角和常用间距已经接入 `client/tailwind.config.js`：

- `rounded-xl` / `rounded-2xl` / `rounded-3xl` 统一映射到 `--app-radius-lg`。
- `gap-3` / `gap-4` 和 `space-y-4` 映射到 `--app-space-card`。
- `gap-5` / `gap-6` 和 `space-y-5` / `space-y-6` 映射到 `--app-space-section`。

页面布局优先使用：

- `app-page`：页面外层 padding。
- `app-stack-section`：页面区块纵向间距。
- `app-stack-card`：卡片内部或紧密内容纵向间距。
- `app-grid-section`：主区块网格间距。
- `app-grid-card`：卡片网格间距。

### 卡片与表单

能用组件时优先用组件；特殊结构再使用语义类。

- 卡片：`Card`、`CardHeader`、`CardContent`、`InfoCard`，或 `app-card surface-panel`。
- 按钮：`Button`、`IconButton`，或 `app-button` / `app-icon-button`。
- 输入：`Input`、`Textarea`、`Select`、`Checkbox`，或 `app-input control-surface`。

移动端间距由 token 自动收缩，不要再用全局 `.p-4`、`.p-6` 覆盖来修页面。

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

---

### Button / IconButton - 按钮组件

统一按钮样式，支持主要、次要、危险、成功、幽灵等变体。

```tsx
import { Button, IconButton } from '@/components/common'

<Button variant="primary" icon={<Icons.SaveIcon />}>保存</Button>
<Button variant="danger" loading={deleting}>删除</Button>
<IconButton icon={<Icons.RefreshIcon />} title="刷新" />
```

常用变体：

- `primary`：主要操作
- `secondary` / `outline`：次级操作
- `success`：成功或确认类操作
- `danger`：危险操作
- `ghost`：低强调操作

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

表单错误态使用 `error` prop，不要在页面里单独手写红色边框和错误文字。

## 重构建议

新增或整理页面时按这个顺序做：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 或 `app-card surface-panel`。
4. 表单使用 `Input`、`Textarea`、`Select`、`Checkbox`。
5. 操作用 `Button`、`IconButton`，状态显示用 `StatusIndicator`。
6. 新颜色、新圆角、新间距优先抽为 token 或语义类。

## 下一步计划

1. ✅ 创建通用组件。
2. ✅ 接入统一色彩、圆角、间距 token。
3. ✅ Button、Input、Modal、Loading 等组件纳入 common。
4. ⏳ 持续把零散手写卡片迁移到 `Card` 或 `app-card`。
5. ⏳ 为核心通用组件补充单元测试或视觉回归检查。

---

**创建时间**：2026-02-09
**最后更新**：2026-07-09
**维护者**：@mps233
