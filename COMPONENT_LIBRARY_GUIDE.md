# 通用组件库与设计规范

## 概述

为了减少重复代码、统一视觉风格、提升开发效率，项目维护一套通用 UI 组件和语义设计 token。通用组件位于 `client/src/components/common/*.tsx`，通过 `client/src/components/common/index.ts` 统一导出。

设计系统的代码来源：

- `client/src/index.css`：颜色、圆角、间距、表面、控件、状态等 CSS 变量和语义类。
- `client/tailwind.config.js`：把常用 `rounded-*`、`gap-*`、`space-*` 映射到统一 token。
- `client/src/components/common`：页面标题、卡片、按钮、输入、弹窗、加载等通用组件。

---

## 设计目标

1. **减少重复代码**：重复 UI 模式优先沉淀到组件或语义类。
2. **统一视觉风格**：页面不再各自定义主色、圆角、间距。
3. **提升开发效率**：新页面优先复用现成组件和布局类。
4. **易于维护**：修改 token 或通用组件即可影响全局。

---

## 设计规范

### 色彩

页面不要再按模块自定义一套主色。除非是明确的状态语义或游戏资源稀有度，新增 UI 优先使用全局语义类：

- `surface-panel`：主要卡片和大面板。
- `surface-soft`：弱背景、状态条、次级容器。
- `control-surface`：输入框、选择框、筛选项、未选中的分段控件。
- `control-active`：选中的分段控件或当前项。
- `brand-action` / `brand-text`：主要操作和品牌强调。
- `status-success` / `status-warning` / `status-danger` / `status-info`：语义状态提示。
- `status-success-action` / `status-danger-action`：成功、危险类操作按钮。
- `form-error-surface` / `form-error-text`：表单错误态。

不要新增页面级 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的颜色主题。需要新语义时，先在 `index.css` 增加 token 或语义类。

### 圆角

圆角以 CSS 变量为准：

| token | 当前值 | 用途 |
| --- | --- | --- |
| `--app-radius-xs` | `0.25rem` | 细小元素、默认边界 |
| `--app-radius-sm` | `0.375rem` | checkbox、小控件 |
| `--app-radius-md` | `0.5rem` | 普通按钮和输入 |
| `--app-radius-lg` | `0.625rem` | 卡片、面板、分段控件 |
| `--app-radius-pill` | `9999px` | 胶囊、头像、圆形状态点 |

Tailwind 中 `rounded-xl`、`rounded-2xl`、`rounded-3xl` 已统一映射到 `--app-radius-lg`。不要为了局部效果继续加更大的圆角；如果某处确实需要特殊造型，先确认是否应当成为新的语义 token。

### 间距

常用间距以语义类为主：

- `app-page`：页面外层 padding。
- `app-stack-card`：卡片内部或紧密内容的纵向间距。
- `app-stack-section`：页面区块之间的纵向间距。
- `app-grid-card`：卡片网格的紧密间距。
- `app-grid-section`：大区块网格间距。

当前 token：

| token | 桌面 | 移动端 | 用途 |
| --- | --- | --- | --- |
| `--app-space-card` | `1rem` | `0.75rem` | 卡片内部、紧密列表 |
| `--app-space-section` | `1.25rem` | `0.875rem` | 页面区块、主网格 |

不要在页面里继续散写大量 `space-y-6`、`gap-6`、`p-6` 来做版式基准。需要页面级布局时优先使用 `app-page`、`app-stack-section`、`app-grid-section`。

### 卡片与容器

通用组件优先级：

1. 能用 `Card`、`CardHeader`、`CardContent`、`InfoCard` 时优先使用组件。
2. 特殊布局不适合组件时，使用语义类：`app-card surface-panel`、`app-card surface-soft`、`app-info-card`。
3. 不要把页面区块都做成层层嵌套卡片；只有真正需要框住的内容才使用卡片。

### 表单与按钮

新增表单优先使用 `Input`、`Textarea`、`Select`、`Checkbox`。必须手写原生控件时，使用：

- 输入控件：`app-input control-surface`
- 复选项外层：`app-checkbox`
- 普通按钮：`app-button`
- 图标按钮：`app-icon-button`

按钮颜色按语义选择 `brand-action`、`status-success-action`、`status-danger-action`，不要按页面重新定义按钮渐变。

### 响应式与滚动

- 移动端间距通过 token 自动收缩，不要再全局覆盖 `.p-4`、`.p-6`、`.gap-6`。
- 页面滚动条当前全局隐藏，避免切换页面或列表时因系统滚动条出现导致布局左右跳动。
- 文本和控件要在移动端自然换行，不允许为了保留桌面布局而裁剪有效内容。

---

## 组件列表

### PageHeader - 页面标题组件

**文件位置**：`client/src/components/common/PageHeader.tsx`

**适用场景**：所有页面的顶部标题区域。

```typescript
{
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  animated?: boolean
}
```

```tsx
import { PageHeader, StatusIndicator } from './components/common'
import Icons from './components/Icons'

<PageHeader
  icon={<Icons.TargetIcon />}
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
  actions={<StatusIndicator isActive={isRunning} />}
/>
```

页面标题统一使用全局品牌色和 `icon-well`，不再支持页面单独传入渐变色。

### StatusIndicator - 状态指示器组件

**文件位置**：`client/src/components/common/StatusIndicator.tsx`

**适用场景**：任务运行状态、加载状态、结果消息。

```typescript
{
  isActive?: boolean
  activeText?: string
  inactiveText?: string
  activeColor?: string
  inactiveColor?: string
  message?: string
  type?: 'success' | 'error' | 'warning' | 'info' | 'default'
}
```

```tsx
import { StatusIndicator } from './components/common'

<StatusIndicator
  isActive={isRunning}
  message={message}
  activeText="运行中"
  inactiveText="就绪"
/>
```

`activeColor` 和 `inactiveColor` 仅作为旧调用兼容参数保留，新代码优先使用 `type` 或让组件根据 `message` 自动识别状态语义。

### Card - 卡片组件系列

**文件位置**：`client/src/components/common/Card.tsx`

**适用场景**：主要面板、信息卡片、带标题的内容区域。

```tsx
import { Card, CardHeader, CardContent, InfoCard } from './components/common'

<Card animated delay={0.1}>
  <CardHeader
    icon={<Icons.Package />}
    title="材料掉落统计"
  />
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
</Card>

<InfoCard type="warning">
  <p>需要用户注意的信息。</p>
</InfoCard>
```

### Button / IconButton

**文件位置**：`client/src/components/common/Button.tsx`

**适用场景**：文本按钮、主要操作、危险操作、图标按钮。

```tsx
import { Button, IconButton } from './components/common'

<Button variant="primary" size="md">保存</Button>
<Button variant="danger" loading={deleting}>删除</Button>
<IconButton icon={<Icons.RefreshCw />} title="刷新" />
```

新增按钮优先走 `variant`，不要在页面里手写一套按钮颜色、阴影和圆角。

### Input / Textarea / Select / Checkbox

**文件位置**：`client/src/components/common/Input.tsx`

**适用场景**：表单输入、选择、错误提示、说明文字。

```tsx
import { Input, Select, Checkbox } from './components/common'

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

---

## 重构建议

新增页面或改老页面时，按下面顺序处理：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 或 `app-card surface-panel`。
4. 表单使用 `Input`、`Select`、`Textarea`、`Checkbox`。
5. 操作用 `Button`、`IconButton`，状态显示用 `StatusIndicator`。
6. 如果出现新的颜色、圆角、间距需求，优先抽成 token 或语义类。

### Tailwind 动态类名

Tailwind CSS 不支持动态拼接类名：

```tsx
// 不要这样写
className={`bg-${color}`}
className={`from-${tone}`}
```

需要按状态切换样式时，使用明确的 class 映射，或优先使用已有语义类。

---

## 维护清单

- [x] 页面级色彩收敛到品牌色与状态语义色。
- [x] 圆角和常用间距接入 Tailwind token。
- [x] 卡片、按钮、输入控件接入 `app-*` 语义类。
- [x] 移动端页面 padding 改由 `app-page` 和 spacing token 控制。
- [ ] 持续把零散手写卡片迁移到 `Card` 或 `app-card`。
- [ ] 为核心通用组件补充单元测试或视觉回归检查。

---

## 参考资料

- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Framer Motion 文档](https://www.framer.com/motion/)
- [React 组件设计模式](https://reactpatterns.com/)

---

**创建时间**：2026-02-09
**最后更新**：2026-07-09
**维护者**：@mps233
