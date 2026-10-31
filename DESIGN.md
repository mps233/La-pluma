# 通用组件库与设计规范

## 概述

为了减少重复代码、统一视觉风格、提升开发效率，项目维护一套通用 UI 组件和语义设计 token。通用组件位于 `client/src/components/common/*.tsx`，通过 `client/src/components/common/index.ts` 统一导出。

设计系统的代码来源：

- `client/src/index.css`：颜色、圆角、间距、表面、控件、状态等 CSS 变量和语义类。
- `client/tailwind.config.js`：把常用 `rounded-*`、`gap-*`、`space-*` 映射到统一 token。
- `client/src/components/common`：页面标题、卡片、按钮、输入、弹窗、加载等通用组件。

---

## 原生响应式壳层与 iOS 风格

应用使用原生 `.la-pluma-app` 根节点。Navbar、页面区域、移动 tabbar 和 Sheet 等 chrome 与交互统一由 `Layout` 及 common 组件提供；`ios-theme.css` 负责 iOS 26 材质、应用 chrome、安全区和品牌适配，不要在页面中另起一套导航或 modal 基础样式。

- 桌面端（`lg` 及以上）显示左侧工作台导航；移动端使用悬浮的 iOS 风格底部胶囊导航，右侧「更多」按钮打开次要页面的 Sheet。两端必须复用 `Layout` 的 URL 路由和 active 状态，不要按 viewport 建立第二份导航状态。
- 桌面工作台使用 macOS 结构侧栏：一条跨越顶栏与导航区的连续圆角材质边界、可用的工作区搜索、分组导航和 24px 图标底座。品牌入口属于侧栏右侧的工作区顶栏，不能进入或遮挡侧栏圆角区。当前项使用整行系统强调色与白色文字；这些桌面样式不得扩散到移动底栏和“更多”Sheet。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 `.la-pluma-app`。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `client/index.html` 使用 `viewport-fit=cover`。`Layout` 通过统一 token 管理 navbar、移动 tabbar 和对应安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- `Button`、`Card`、`Loading`、`Switch` 等 common 组件使用原生语义元素，在浏览器、jsdom、SSR 和嵌入式场景中渲染一致。不要按运行环境维护第二套组件 DOM。
- 浏览器默认样式与第三方样式可能影响按钮宽度、卡片外边距和活动指示器尺寸；这类基础规则集中放在 `ios-theme.css`、`index.css` 或 common 组件中，调用处不要用局部覆盖扩散规则。

桌面和移动端都要检查 light/dark、loading、disabled、empty、error 以及长标题/长操作文案；安全区设备还应确认 chrome 与页面内容没有双重留白。

---

## 设计规范

### 色彩

页面不要再按模块自定义一套主色。除非是明确的状态语义或游戏资源稀有度，新增 UI 优先使用全局语义类：

- `surface-panel`：主要卡片和大面板。
- `surface-soft`：弱背景、状态条、次级容器。
- `control-surface`：输入框、选择框、筛选项、未选中的分段控件。
- `brand-action` / `brand-text`：主要操作和品牌强调。
- `status-neutral` / `status-success` / `status-warning` / `status-danger` / `status-info`：语义状态提示。中性状态用于待机、默认或与状态无关的提示浮层；它自带 1px 内描边，不受 `ios-borderless-cards` 影响，因此浮层在各类页面外观一致。
- `status-success-action` / `status-danger-action`：成功、危险类操作按钮。
- `form-error-surface` / `form-error-text`：表单错误态。

不要新增页面级 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的颜色主题。需要新语义时，先在 `index.css` 增加 token 或语义类。

### 文字层级

新增页面优先复用下列层级，不要为普通文本继续增加任意字号或字重：

| 层级 | 推荐样式 | 用途 |
| --- | --- | --- |
| 页面标题 | 由 `PageHeader` 的 `.app-page-title` 决定 | 仅页面主标题；不要在页面里重写字号和字重 |
| 常规卡片标题 | `text-lg font-semibold text-primary` | `CardHeader`、主要内容区标题 |
| 紧凑区块标题 | `text-base font-bold text-primary` | 总览卡片内的次级区块 |
| 列表标题、字段名 | `text-sm font-semibold` | 列表项、配置字段、主要操作文案 |
| 正文、表单标签 | `text-sm text-secondary` | 描述、输入标签、普通按钮 |
| 辅助说明、标签 | `text-xs text-tertiary` | 元数据、提示、筛选标签 |
| KPI 主数值 | `text-3xl font-bold text-primary` | 仅控制台总览或统计主指标，默认不超过 32px |

多行正文和说明使用 `leading-6` 或 `leading-relaxed`；单行标签和数值保持默认紧凑行高。标题和中文正文不要新增 letter spacing，英文全大写微标签才可使用更宽字距。字重使用 `400`、`500`、`600`、`700`，不要使用依赖系统字体插值的 `650`、`750`、`780`。`11px` 仅用于序号、时间戳和短元数据；`8px` 至 `10px` 不得承载中文正文、操作名或重要状态。

彩色、半透明或渐变背景上的文字必须按渲染结果满足 WCAG AA（正文 4.5:1，大字号 3:1），并在浅色和深色两套主题下分别核对：

- 品牌色文字优先使用 `--app-accent-strong`，它是为「浅底和深底都能读」准备的文字色；`--app-accent` 只用于填充和描边，不要直接压在浅色 tint 上承载文字。状态色同样优先选择对应的 `*-text` 或 `*-action` 变体。
- 不要用 `opacity` 降低文字对比度来制造层级（例如用 `opacity-70` 做次级标签），改用语义文字色 `--app-text-muted` / `--app-text-soft`。透明度会随背景叠加，浅色主题下往往比深色更早失效。
- 渐变、图片和设备画面上的文字最容易失手，必须在真实渲染页面上取样测量，不能只看颜色变量；只测一套主题会漏掉另一套的失败。

### 页面宽度

高密度工具页面使用统一的 `app-shell`：内容宽度、左右留白和安全区由 `--app-content-max`、`--app-page-gutter` 等 token 控制，`Layout` 已经把 `la-pluma-content app-shell` 渲染在页面外层。不要在页面里重复这些数值，也不要再次嵌套 `max-w-7xl` 或重复水平 padding；阅读型长文本应在自己的内容区单独限制行宽。

### 圆角

圆角以 CSS 变量为准：

| token | 用途 |
| --- | --- |
| `--app-radius-xs` | 细小元素、默认边界 |
| `--app-radius-sm` | checkbox、小控件 |
| `--app-radius-md` | 紧凑控件与局部容器 |
| `--app-radius-lg` | 卡片、面板、分段控件、通用按钮和输入 |
| `--app-radius-pill` | 胶囊、头像、圆形状态点 |

具体数值由 `client/src/index.css` 定义、`client/src/ios-theme.css` 覆盖（iOS 外壳下的圆角明显大于基础主题）。不要把数值抄进文档或页面代码，需要精确值时读 token 或浏览器计算结果。

Tailwind 中 `rounded-xl`、`rounded-2xl`、`rounded-3xl` 已统一映射到 `--app-radius-lg`。不要为了局部效果继续加更大的圆角；如果某处确实需要特殊造型，先确认是否应当成为新的语义 token。

### 边框

普通可见边框统一使用 `1px`，颜色使用 `var(--app-border)`；需要更明确分隔时使用 `var(--app-border-strong)`。卡片、输入框、分段控件和普通信息容器不得按页面单独改成 `border-2` 或重色描边。

`2px` 只用于小尺寸控件的可辨识性或非容器结构，例如复选框外框和勾选符号、层级引导线、加载圈。焦点环和阴影不是容器边框，不受此规则限制。新增例外前，应确认 1px 是否已经足够表达层级。

### 阴影

阴影只表达高度和层级，不承载品牌语义：

- 统一使用中性投影，例如 `0 5px 14px rgba(0, 0, 0, 0.16)`、`0 10px 24px rgba(0, 0, 0, 0.18)`。同一页面内的投影方向保持一致：向下、无水平偏移，靠模糊半径和透明度区分层级。
- 禁止用品牌色或状态色做模糊投影，包括 `0 8px 20px color-mix(in srgb, var(--app-accent) 20%, transparent)` 这类写法。需要强调主操作时，用词重、填充色和尺寸，不要靠发光。
- 禁止零偏移的彩色光环（`0 0 0 3px` 配彩色）和彩色 `text-shadow`。唯一例外是状态指示点的语义光环：扩散不超过 `3px`，透明度不超过 `20%`。
- `inset 0 0 0 1px` 的边缘高光、`inset 0 -1px 0` 的分隔线属于边缘而不是阴影，可以继续使用。
- 悬停和按下状态沿用同一套中性投影，只调整透明度，不要换成彩色投影或加大光晕。

### 间距

常用间距以语义类为主：

- `app-page`：页面外层 padding。
- `ios-workspace-page`：需要复用控制台移动材质与紧凑标题的功能页，和 `app-page` 同层使用。
- `app-stack-card`：卡片内部或紧密内容的纵向间距。
- `app-stack-section`：页面区块之间的纵向间距。

| token | 用途 |
| --- | --- |
| `--app-space-card` | 卡片内部、紧密列表 |
| `--app-space-section` | 页面区块、主网格 |

数值同样由 `index.css` 定义、`ios-theme.css` 覆盖，移动端还会再收缩一档；不要在文档或页面里写死具体像素。

基础尺度遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 分别为 4、8、12、16、20、24px。新增全局或通用组件间距时优先用这些 token；页面外层使用 `--app-space-page`，通用卡片内边距使用 `--app-space-panel`，表单控件使用 `--app-space-control-x`。移动端会自动收缩页面、卡片和区块尺度。

Tailwind 已把常用档位映射到这些 token：`gap-3` / `gap-4` / `space-y-4` 对应 `--app-space-card`，`gap-5` / `gap-6` / `space-y-5` / `space-y-6` 对应 `--app-space-section`。写版式时优先复用这些档位，不要为同一间距再引入新的任意值。

不要在页面里继续散写大量 `space-y-6`、`gap-6`、`p-6` 来做版式基准。需要页面级布局时优先使用 `app-page`、`app-stack-section`。

### 卡片与容器

通用组件优先级：

1. 能用 `Card`、`CardHeader`、`CardContent`、`SmoothPanel` 时优先使用组件。
2. 特殊布局不适合组件时，使用语义类：`app-card surface-panel`、`app-card surface-soft`、`app-info-card`。
3. 不要把页面区块都做成层层嵌套卡片；只有真正需要框住的内容才使用卡片。

### 表单与按钮

新增表单优先使用 `Input`、`Select`、`Checkbox`、`Switch`。二元启停设置使用 `Switch`，多选或参数组合使用 `Checkbox`。多行文本和其他必须手写的原生控件使用：

- 输入控件：`app-input control-surface`
- 复选项外层：`app-checkbox`
- 普通按钮：`app-button`
- 图标按钮：`app-icon-button`

iOS 风格三档 `Button` 高度由 `app-button-size-sm`、`app-button-size-md`、`app-button-size-lg` 统一管理，桌面分别为 36、44、48px；`Input` 和 `Select` 为 44px。手机断点和粗指针设备会把所有标准按钮、图标按钮与表单点击区提升到至少 44px。不要在调用处再叠加 `h-*`、`px-*`、`py-*` 缩小标准控件；图标专用工具条只有在桌面高密度场景才可明确使用更紧凑的尺寸，且不能承载文字。

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
| 控制台首次且没有本地缓存 | 控制台内部的 `DashboardSkeleton`；恢复或返回页面时先显示最后一次成功快照并后台刷新，不要重播整页骨架 |
| 局部内容正在读取 | `Loading` |
| 列表、流程或卡片无数据 | `EmptyState`，按容器选择 `compact` |
| 区域读取失败 | 在原区域显示可恢复的错误与重试操作；不要改成空状态 |
| 全局结果与错误 | `useStatusStore.setMessage`，由 `FloatingStatusIndicator` 展示；错误持续到用户关闭，其他短消息由 store 自动收起，不要自行写清除定时器 |
| 删除、清空等不可逆操作 | `ConfirmDialog`；新代码不得使用 `window.confirm` |

日志控制台、养成筛选空结果等固定高度或高密度区域可保留专用状态样式。局部表单成功提示、日志提示等需要紧邻操作区或可手动关闭时，也可保留在面板内。项目没有通用 Toast 组件，`FloatingStatusIndicator` 是全局任务状态和短消息载体，不应被当作普通 toast 复刻。

`ConfirmDialog.onConfirm` 可以返回 Promise。返回 `false` 或抛出错误时弹窗保持打开；错误会在弹窗内展示，调用方不要提前关闭弹窗或吞掉失败结果。

### 图标

- 普通功能图标优先使用已引入的 `lucide-react`；业务身份和概览图标优先复用 `Icons.tsx`。一级工作区标题与控制台一致，不添加装饰图标；不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。`icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标。
- 无文字操作使用 `IconButton`，调用时必须提供 `title` 和 `aria-label`；有文字的操作使用 `Button icon`，不要在调用处额外覆盖图标与文字间距或按钮尺寸。
- `IconButton` 的 `sm`、`md`、`lg` 与相同档位的 `Button` 共用尺寸，并在手机和粗指针设备保持至少 44px。不要页面自行缩小点击面积；32px 仅保留给明确的桌面高密度图标工具条，不得承载文字。
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
- 区块间使用 `app-stack-section`，卡片内使用 `app-stack-card`。只有内容可独立扫描、操作或滚动时才使用卡片；内部分区优先用 `CardHeader`、`CardContent`、分隔线、网格或 `surface-soft`。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`，主内容必须保持弹性。每一列都应有 `minmax(0, ...)` 或 `min-w-0`，避免长文本造成横向溢出。
- 不要为了填满右侧留白而硬塞第二张卡，也不要把普通页面区块做成卡片嵌套卡片。独立工作区、弹窗、空状态和设备预览属于合理例外。
- 自动化编排器、肉鸽工作区是高密度专用布局：前者按三栏/两栏/单栏专用断点折叠，后者在窄屏转单栏。它们不是新页面的默认模板。

---

## 组件列表

### 组件选型

组件细节（props、导入方式、示例）统一维护在 `client/src/components/common/README.md`，本节只说明什么时候用哪个。

| 场景 | 组件 |
| --- | --- |
| 页面标题与操作区 | `PageHeader` |
| 卡片与分区 | `Card` / `CardHeader` / `CardContent`；需要连续曲率时用 `SmoothPanel` |
| 操作 | `Button`（有文字）、`IconButton`（仅图标，必须带 `title` 与 `aria-label`） |
| 表单 | `Input`、`Select`、`Checkbox`、`Switch`；多行文本用带 `app-input control-surface` 的原生 `textarea` |
| 空状态 | `EmptyState`，只用于确实没有数据 |
| 不可逆操作确认 | `ConfirmDialog` |
| 局部加载 | `Loading`；控制台骨架用 `DashboardSkeleton` |
| 动态分段标签 | `useFluidTabIndicator` |

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

新增页面或改老页面时按这个顺序：

1. 页面外层 `app-page` + `app-stack-section`，标题使用 `PageHeader`。
2. 大面板使用 `Card` 或 `SmoothPanel`，内部分区用分隔线、网格或透明分组。
3. 表单、按钮、空状态、加载按「组件选型」表选择，不要手写等价实现。
4. 新的颜色、圆角、间距需求先抽成 token 或语义类，再落到页面。

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

- [ ] 持续把零散手写卡片迁移到 `Card` 或 `app-card`。
- [ ] 为核心通用组件补充单元测试或视觉回归检查。
- [ ] 每次改颜色或字号，在浅色和深色两套主题的真实渲染页面上各核对一次对比度。

---

**创建时间**：2026-02-09
**最后更新**：2026-11-01
**维护者**：@mps233
