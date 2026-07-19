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

## Framework7 壳层与 iOS 风格

应用根节点由 `Framework7App` 提供，统一使用 Framework7 9 的 `theme="ios"`。Navbar、Page、Toolbar/tabbar、Sheet 等页面 chrome 和交互优先使用 `framework7-react`；`framework7-overrides.css` 只做 La Pluma 的语义 token、密度和品牌适配，不要在页面中另起一套导航或 modal 基础样式。

- 桌面端（`lg` 及以上）显示左侧工作台导航；移动端使用悬浮的 iOS 风格底部胶囊导航，右侧搜索/更多入口承载次要页面。两端必须复用 `Layout` 的 URL 路由和 active 状态，不要按 viewport 建立第二份导航状态。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 Framework7 根节点。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `client/index.html` 使用 `viewport-fit=cover`。Framework7 navbar、toolbar/tabbar 自己拥有安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- `Button`、`Card`、`Loading` 等 common 组件在 `Framework7RuntimeProvider` 内渲染 Framework7 版本；provider 外的原生版本用于 jsdom 测试、SSR 和嵌入式场景。不要通过检查 DOM 是否已经存在 `#framework7-root` 来决定首屏组件类型。
- Framework7 的全局 form reset 可能影响原有按钮宽度、卡片外边距和 preloader 尺寸；这类兼容规则集中放在 `framework7-overrides.css` 或 common 组件中，调用处不要用局部覆盖扩散规则。

桌面和移动端都要检查 light/dark、loading、disabled、empty、error 以及长标题/长操作文案；安全区设备还应确认 chrome 与页面内容没有双重留白。

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

### 文字层级

新增页面优先复用下列层级，不要为普通文本继续增加任意字号或字重：

| 层级 | 推荐样式 | 用途 |
| --- | --- | --- |
| 页面标题 | `text-xl sm:text-2xl font-semibold text-primary` | 仅 `PageHeader` 的页面主标题 |
| 常规卡片标题 | `text-lg font-semibold text-primary` | `CardHeader`、主要内容区标题 |
| 紧凑区块标题 | `text-base font-bold text-primary` | 总览卡片内的次级区块 |
| 列表标题、字段名 | `text-sm font-semibold` | 列表项、配置字段、主要操作文案 |
| 正文、表单标签 | `text-sm text-secondary` | 描述、输入标签、普通按钮 |
| 辅助说明、标签 | `text-xs text-tertiary` | 元数据、提示、筛选标签 |
| KPI 主数值 | `text-3xl font-bold text-primary` | 仅控制台总览或统计主指标，默认不超过 32px |

多行正文和说明使用 `leading-6` 或 `leading-relaxed`；单行标签和数值保持默认紧凑行高。标题和中文正文不要新增 letter spacing，英文全大写微标签才可使用更宽字距。字重使用 `400`、`500`、`600`、`700`，不要使用依赖系统字体插值的 `650`、`750`、`780`。`11px` 仅用于序号、时间戳和短元数据；`8px` 至 `10px` 不得承载中文正文、操作名或重要状态。

### 页面宽度

高密度工具页面使用统一的 `app-shell`：内容最大宽度为 `1600px`，桌面左右留白通常为 `32px`，超宽屏为 `40px`，移动端为 `14px`。页面内部不要再次嵌套 `max-w-7xl` 或重复水平 padding；阅读型长文本应在自己的内容区单独限制行宽。

### 圆角

圆角以 CSS 变量为准：

| token | 当前值 | 用途 |
| --- | --- | --- |
| `--app-radius-xs` | `0.25rem` | 细小元素、默认边界 |
| `--app-radius-sm` | `0.375rem` | checkbox、小控件 |
| `--app-radius-md` | `0.5rem` | 紧凑控件与局部容器 |
| `--app-radius-lg` | `0.625rem` | 卡片、面板、分段控件、通用按钮和输入 |
| `--app-radius-pill` | `9999px` | 胶囊、头像、圆形状态点 |

Tailwind 中 `rounded-xl`、`rounded-2xl`、`rounded-3xl` 已统一映射到 `--app-radius-lg`。不要为了局部效果继续加更大的圆角；如果某处确实需要特殊造型，先确认是否应当成为新的语义 token。

### 边框

普通可见边框统一使用 `1px`，颜色使用 `var(--app-border)`；需要更明确分隔时使用 `var(--app-border-strong)`。卡片、输入框、分段控件和普通信息容器不得按页面单独改成 `border-2` 或重色描边。

`2px` 只用于小尺寸控件的可辨识性或非容器结构，例如复选框外框和勾选符号、层级引导线、加载圈。焦点环和阴影不是容器边框，不受此规则限制。新增例外前，应确认 1px 是否已经足够表达层级。

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

基础尺度遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 分别为 4、8、12、16、20、24px。新增全局或通用组件间距时优先用这些 token；页面外层使用 `--app-space-page`，通用卡片内边距使用 `--app-space-panel`，表单控件使用 `--app-space-control-x`。移动端会自动收缩页面、卡片和区块尺度。

不要在页面里继续散写大量 `space-y-6`、`gap-6`、`p-6` 来做版式基准。需要页面级布局时优先使用 `app-page`、`app-stack-section`、`app-grid-section`。

### 卡片与容器

通用组件优先级：

1. 能用 `Card`、`CardHeader`、`CardContent`、`InfoCard` 时优先使用组件。
2. 特殊布局不适合组件时，使用语义类：`app-card surface-panel`、`app-card surface-soft`、`app-info-card`。
3. 不要把页面区块都做成层层嵌套卡片；只有真正需要框住的内容才使用卡片。

### 表单与按钮

新增表单优先使用 `Input`、`Select`、`Checkbox`。多行文本和其他必须手写的原生控件使用：

- 输入控件：`app-input control-surface`
- 复选项外层：`app-checkbox`
- 普通按钮：`app-button`
- 图标按钮：`app-icon-button`

三档 `Button` 的高度固定为 36、40、44px，由 `app-button-size-sm`、`app-button-size-md`、`app-button-size-lg` 统一管理；`Input` 和 `Select` 固定为 40px。不要在调用处再叠加 `h-*`、`px-*`、`py-*` 改变标准控件密度。图标专用工具条可明确使用更紧凑的尺寸，但不能承载文字。

### 交互状态与动效

- 交互元素优先复用 `Button`、`IconButton`、`control-surface` 和 `surface-panel-hover`。不要为同类控件新增亮色渐变、强光晕或重投影。
- 主、成功、危险操作的 hover 只做主题色压暗；次级与幽灵操作只使用弱主题背景或轻描边。普通卡片默认保持稳定，只有卡片本身可点击时才使用 `surface-panel-hover` 或启用 `Card hover`；不要给静态内容卡片增加投影闪动或位移。
- 所有可点击元素必须有明确的 `focus-visible` 状态。优先复用 `Button`，手写控件至少添加 `focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]`，不能只提供 hover。
- disabled 状态需关闭点击与 hover，并使用 `opacity-50`、`cursor-not-allowed`；loading 期间按钮自动禁用，仅显示加载内容。
- 通用颜色、背景、阴影、变形过渡保持约 160 至 180ms；新增 CSS 或 Framer Motion 动效必须尊重 reduced motion。专用高光动画可例外，但不可用于普通按钮。
- `status-border-beam` 仅用于启动、连接或执行中的局部状态反馈，并通过 `is-active` 控制；完成、空闲和静态卡片不得常驻光效，也不要叠加第二条可见边框。

### 反馈状态

按下面顺序选择反馈方式，不要用空状态伪装错误，也不要为同一结果重复显示多种提示：

| 情况 | 使用方式 |
| --- | --- |
| 字段校验失败 | `Input`、`Select` 的 `error` prop；`hint` 只在没有错误时显示 |
| 控制台结构正在加载 | 控制台内部的 `DashboardSkeleton`，不要在其他页面复制其布局 |
| 局部内容正在读取 | `Loading` |
| 列表、流程或卡片无数据 | `EmptyState`，按容器选择 `compact` |
| 区域读取失败 | 在原区域显示可恢复的错误与重试操作；不要改成空状态 |
| 全局结果与错误 | `useStatusStore.setMessage`，由 `FloatingStatusIndicator` 展示；错误持续到用户关闭，其他短消息由 store 自动收起，不要自行写清除定时器 |
| 删除、清空等不可逆操作 | `ConfirmDialog`；新代码不得使用 `window.confirm` |

日志控制台、养成筛选空结果等固定高度或高密度区域可保留专用状态样式。局部表单成功提示、日志提示等需要紧邻操作区或可手动关闭时，也可保留在面板内。项目没有通用 Toast 组件，`FloatingStatusIndicator` 是全局任务状态和短消息载体，不应被当作普通 toast 复刻。

`ConfirmDialog.onConfirm` 可以返回 Promise。返回 `false` 或抛出错误时弹窗保持打开；错误会在弹窗内展示，调用方不要提前关闭弹窗或吞掉失败结果。

### 图标

- 普通功能图标优先使用已引入的 `lucide-react`；业务身份、页面标题和概览图标优先复用 `Icons.tsx`。不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。`icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标。
- 无文字操作使用 `IconButton`，调用时必须提供 `title` 和 `aria-label`；有文字的操作使用 `Button icon`，不要在调用处额外覆盖图标与文字间距或按钮尺寸。
- `IconButton` 的 `sm`、`md`、`lg` 已固定为 36、40、44px。不要页面自行缩小点击面积；32px 仅保留给明确的高密度图标工具条，不得承载文字。
- 装饰图标加 `aria-hidden="true"`；状态和结果必须同时提供可读文字或 `aria-label`，不能只依赖颜色和图标。

按钮颜色按语义选择 `brand-action`、`status-success-action`、`status-danger-action`，不要按页面重新定义按钮渐变。

### 响应式与滚动

- 移动端间距通过 token 自动收缩，不要再全局覆盖 `.p-4`、`.p-6`、`.gap-6`。
- 页面滚动条当前全局隐藏，避免切换页面或列表时因系统滚动条出现导致布局左右跳动。
- 文本和控件要在移动端自然换行，不允许为了保留桌面布局而裁剪有效内容。
- 新页面按 mobile-first 编写：`sm` (640px) 用于显示次级信息或恢复横向工具栏，`md` (768px) 用于中等宽度布局，`lg` (1024px) 与 `xl` (1280px) 才扩展为双栏或多栏。不要新增 `899px`、`1023px` 这类页面级断点；自动化三栏等既有组件可保留自身的专用断点。
- 窄屏下主内容默认单列，顶部操作可纵向排列或全宽；双栏/三栏要在内容不足时按列折叠，不能以固定宽度挤压正文。移动端页面、卡片和区块间距由 spacing token 自动收缩，不要为常规容器再单独覆盖 padding。

### 布局密度

- 常规内容宽度为 `max-w-7xl`。`Layout` 已负责主内容居中与外层 padding；页面内部避免再套一层同用途的宽度和 padding 容器。
- 区块间使用 `app-stack-section` / `app-grid-section`，卡片内使用 `app-stack-card` / `app-grid-card`。只有内容可独立扫描、操作或滚动时才使用卡片；内部分区优先用 `CardHeader`、`CardContent`、分隔线、网格或 `surface-soft`。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`，主内容必须保持弹性。每一列都应有 `minmax(0, ...)` 或 `min-w-0`，避免长文本造成横向溢出。
- 不要为了填满右侧留白而硬塞第二张卡，也不要把普通页面区块做成卡片嵌套卡片。独立工作区、弹窗、空状态和设备预览属于合理例外。
- 自动化编排器、肉鸽工作区是高密度专用布局：前者按三栏/两栏/单栏专用断点折叠，后者在窄屏转单栏。它们不是新页面的默认模板。

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
  mobileLayout?: 'stack' | 'inline'
}
```

```tsx
import { PageHeader } from '@/components/common'
import FloatingStatusIndicator from '@/components/FloatingStatusIndicator'

<PageHeader
  icon={<Icons.TargetIcon />}
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
  actions={<FloatingStatusIndicator />}
/>
```

页面标题统一使用全局品牌色和 `icon-well`，不再支持页面单独传入渐变色。
手机端默认使用 `stack` 保护长标题和多操作；只有控制台这类标题与操作都能稳定收缩的紧凑标题栏才使用 `mobileLayout="inline"`。

### Card - 卡片组件系列

**文件位置**：`client/src/components/common/Card.tsx`

**适用场景**：主要面板、信息卡片、带标题的内容区域。

```tsx
import { Card, CardHeader, CardContent, InfoCard } from '@/components/common'

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

`Card` 支持 `animated`、`delay` 和 `className`。`CardHeader` 可传入 `actions`，`CardContent` 与 `InfoCard` 均支持 `className`。

### Button / IconButton

**文件位置**：`client/src/components/common/Button.tsx`

**适用场景**：文本按钮、主要操作、危险操作、图标按钮。

```tsx
import { Button, IconButton } from '@/components/common'

<Button variant="primary" size="md">保存</Button>
<Button variant="danger" loading={deleting}>删除</Button>
<IconButton icon={<Icons.RefreshCw />} title="刷新" />
```

`Button` 支持 `primary`、`secondary`、`outline`、`success`、`danger`、`ghost`。`IconButton` 仅支持 `primary`、`secondary`、`danger`、`ghost`。新增按钮优先走 `variant`，不要在页面里手写一套按钮颜色、阴影和圆角。

### Input / Select / Checkbox

**文件位置**：`client/src/components/common/Input.tsx`

**适用场景**：表单输入、选择、错误提示、说明文字。

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

`Input`、`Select` 均支持 `error` 和 `hint`，`Input` 额外支持前置 `icon`。多行文本使用带 `app-input control-surface` 的原生 `textarea`。

### EmptyState

**文件位置**：`client/src/components/common/EmptyState.tsx`

**适用场景**：流程、列表、统计区或数据面板暂时没有内容。通过 `index.ts` 导入，不要在页面中各自拼装“暂无数据”的图标、文案和间距。

```tsx
import { EmptyState, Button } from '@/components/common'

<EmptyState
  compact
  icon={<Icons.TrendingUp />}
  title="暂无掉落记录"
  description="执行作战并完成材料识别后，会在这里汇总掉落。"
  action={<Button variant="secondary">刷新</Button>}
/>
```

`title` 为必填；`icon`、`description`、`action` 均可选。卡片内部使用 `compact`，页面级空状态保留默认尺寸。已有自动化流程和掉落记录页使用该组件。

### ConfirmDialog / Loading

**文件位置**：`client/src/components/common/Modal.tsx`、`client/src/components/common/Loading.tsx`

**适用场景**：需要确认的破坏性操作使用 `ConfirmDialog`；短时局部等待使用 `Loading`。两者都由 common 的 `index.ts` 导出。控制台专用的 `DashboardSkeleton` 由 `Dashboard` 直接从 `Loading.tsx` 引入，不属于公共组件导出。

```tsx
import { ConfirmDialog, Loading } from '@/components/common'

{loading ? <Loading text="正在读取日志..." /> : content}
<ConfirmDialog
  isOpen={confirmOpen}
  onClose={() => setConfirmOpen(false)}
  onConfirm={handleDelete}
  title="确认删除"
  message="此操作不可撤销。"
/>
```

### useFluidTabIndicator

**文件位置**：`client/src/hooks/useFluidTabIndicator.ts`

**适用场景**：带有 Framer Motion 高亮底层的分段标签。它会在切换、容器尺寸变化、标签内容变化和窗口缩放时，把高亮层对齐到当前按钮。不要在每个页面重复维护 `ResizeObserver`、元素 ref 和坐标计算。

```tsx
const { containerRef, activeRect, setTabRef } = useFluidTabIndicator(activeTab)

<div ref={containerRef} className="relative">
  <motion.div
    className="pointer-events-none absolute"
    animate={{
      x: activeRect.x,
      y: activeRect.y,
      width: activeRect.width,
      height: activeRect.height,
    }}
  />
  {tabs.map((tab) => (
    <button key={tab.id} ref={setTabRef(tab.id)}>{tab.label}</button>
  ))}
</div>
```

标签 ID 需是字符串联合类型，且高亮容器需要 `relative` 定位。作业、养成和肉鸽页面已使用该 Hook。

---

## 重构建议

新增页面或改老页面时，按下面顺序处理：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 或 `app-card surface-panel`。
4. 表单使用 `Input`、`Select`、`Checkbox`；多行文本复用 `app-input control-surface`。
5. 没有内容时使用 `EmptyState`，不要重复手写空状态。
6. 动态分段标签优先使用 `useFluidTabIndicator`，不要复制测量逻辑。
7. 页面全局执行状态使用 `FloatingStatusIndicator`；局部状态使用既有 `status-*` 语义类并紧邻相关操作。
8. 操作用 `Button`、`IconButton`。
9. 如果出现新的颜色、圆角、间距需求，优先抽成 token 或语义类。

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
**最后更新**：2026-07-11
**维护者**：@mps233
