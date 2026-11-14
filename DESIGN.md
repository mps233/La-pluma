---
name: La Pluma Next
description: 面向《明日方舟》自动化的本地 Web 控制台，使用 macOS 工作台结构与 iOS 26 材质。
colors:
  bg: "#f2f2f7"
  bg-soft: "#e5e5ea"
  surface: "rgba(255, 255, 255, 0.72)"
  surface-solid: "#ffffff"
  surface-muted: "rgba(118, 118, 128, 0.12)"
  border: "rgba(60, 60, 67, 0.18)"
  border-strong: "rgba(60, 60, 67, 0.28)"
  text: "#1c1c1e"
  text-muted: "#636366"
  text-soft: "#8e8e93"
  accent: "#007aff"
  accent-strong: "#005ecb"
  accent-action: "#0066cc"
  accent-action-pressed: "#0055b3"
  accent-soft: "rgba(0, 122, 255, 0.12)"
  success: "#34c759"
  success-text: "#1f7a36"
  success-action: "#248a3d"
  warning: "#ff9500"
  danger: "#ff3b30"
  danger-action: "#d70015"
  info: "#5856d6"
  dark-bg: "#000000"
  dark-bg-soft: "#1c1c1e"
  dark-surface: "#1c1c1e"
  dark-surface-muted: "rgba(118, 118, 128, 0.24)"
  dark-border: "rgba(235, 235, 245, 0.18)"
  dark-border-strong: "rgba(235, 235, 245, 0.28)"
  dark-text: "#f2f2f7"
  dark-text-muted: "#aeaeb2"
  dark-text-soft: "#8e8e93"
  dark-accent: "#0a84ff"
  dark-accent-strong: "#64b5ff"
  dark-accent-soft: "rgba(10, 132, 255, 0.2)"
  dark-success: "#30d158"
  dark-warning: "#ff9f0a"
  dark-danger: "#ff453a"
  dark-info: "#5e5ce6"
typography:
  page-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif'
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.35
  section-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.45
  card-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "6px"
  sm: "10px"
  md: "13px"
  lg: "16px"
  continuous: "20px"
  continuous-compact: "16px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  card: "14px"
  section: "18px"
  page: "20px"
  panel: "16px"
  control-x: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-action}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-action-pressed}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  nav-active:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
---

# Design System: La Pluma Next

## Overview

**Creative North Star: "The Precision Workbench"**

La Pluma Next 是一个高密度的本地自动化控制台，不是营销页面。它的界面首先是一张工作台：macOS 风格的固定侧栏负责工作区导航，中央区域承载任务编排、日志、数据和设备预览，移动端则退化为悬浮的 iOS 26 胶囊导航。所有控件都应当像加工过的系统控件：尺寸精确、反馈短促、层级清楚，不靠装饰制造存在感。

浅色主题读起来像冷调纸面与磨砂玻璃，深色主题则是近黑石墨与同一支蓝色信号。密度是刻意保留的：信息可以很满，但层级必须由字重、1px 发丝线和间距 token 建立，而不是由彩色卡片、渐变或投影堆出来。强调色是稀缺资源，只出现在当前导航项、主操作、焦点和运行中的状态上。

**Key Characteristics:**
- 原生语义优先：`Button`、`Card`、`Input`、`Switch` 等 `shared/components` 通用组件使用真实语义元素，浏览器、jsdom、SSR 和嵌入式场景渲染一致。
- 单强调色：系统蓝承担品牌、主操作、焦点和选中态；状态色只表达成功、警告、危险和信息。
- 分层而不炫技：普通内容面保持平整，只有 chrome、弹层和可点击卡片使用玻璃、抬升或 hover 阴影。
- 4px 节奏：布局间距使用 Tailwind 原生档位与组件类；圆角使用 `--radius` 派生档位。
- 移动优先：断点从内容需要出发，不复制桌面布局，也不建立第二套导航状态。

### Source of Truth

- `apps/web/src/styles/index.css`：语义 token 的**唯一来源**（base 层）、Tailwind 入口、`@theme` 圆角派生与 `@theme inline` 颜色映射、通用组件类与跨域 keyframes；页面样式由各功能域自持。
- `apps/web/src/styles/ios-theme.css`：只保留 iOS 26 独有的材质 token（`--glass-*`）、结构几何 token（`--la-pluma-*`）与对应样式；不再重定义语义 token。
- `apps/web/src/shared/components`：`Button`、`IconButton`、`Card`、`Input`、`Select`、`Checkbox`、`Switch`、`Modal`、`PageHeader`、`EmptyState`、`Loading` 等通用组件；shadcn 生成物（sheet、sidebar、button 等）位于 `apps/web/src/shared/ui`。

本文件描述规则；token 的具体数值以 `apps/web/src/styles/index.css` 为准，调整 token 时同步更新本文件的表格与说明。

## 层序与 token 单源

`apps/web/src/styles/index.css` 首行先声明完整层序，再导入 Tailwind：

```css
@layer theme, base, components, page, utilities;
@import "tailwindcss";
```

- **utilities 永远赢**：`page` 位于 `components` 之后、`utilities` 之前；页面 CSS 可以覆盖 base/preflight 与 components，但普通声明不再压过 utilities。确实需要压过 utilities 的页面/组件规则使用 `!important` 并在原位注释原因。
- **page 层**：每个功能域自持自己的页面样式，放在 `features/<domain>/styles/<domain>.css`，由该域 `index.ts` 导入一次，全部位于 `@layer page`；`index.css` 只保留跨域 keyframes，`ios-theme.css` 只保留 iOS 26 chrome 与跨域 page-kind 材质（`.ios-workspace-page`、`.ios-borderless-cards`、`[data-automation-tasks]` + `[data-workbench-tasks]` 组合、`.la-pluma-content` 控件、浮层）；通用组件类留在 `@layer components`。
- **域内 CSS 按普通 CSS 处理**：功能域样式文件不经过 Tailwind 入口的编译与降级流水线，不要在其中使用 `@apply`/`@theme` 等 Tailwind 指令；需要厂商前缀的能力按现有写法显式补齐（如 `-webkit-backdrop-filter`），浏览器下限仍以 v4 目标为准。
- **token 单源**：语义 token（颜色、圆角、间距、字号、控件高度等）只在 `index.css` 的 `:root` / `html.dark, #app-root.dark` / 媒体查询中定义一次。浅色、深色、`prefers-contrast`、`prefers-reduced-transparency` 的最终生效值都写在这里；`ios-theme.css` 不再出现同名重定义。
- **深色切换**：主题仍同时给 `html` 与 `#app-root` 加 `.dark`；`html.dark` 与 `#app-root.dark` 都保留为有效选择器。

## 档位即规范（Tailwind 原生尺度）

应用直接使用 Tailwind v4 原生档位，不做压缩映射或定向重映射。

- **圆角**：由 `index.css` 的 `--radius: 0.75rem` 经标准派生得到常用四档——`rounded-sm` = `calc(var(--radius) - 4px)`（8px）、`rounded-md` = `- 2px`（10px）、`rounded-lg` = `var(--radius)`（12px）、`rounded-xl` = `+ 4px`（16px）；`rounded-2xl`、`rounded-3xl` 等更大档位沿用 v4 默认静态值，胶囊用 `rounded-full`。
- **间距**：沿用 v4 动态 spacing 尺度的 .5 步进，卡片内紧密间距用 `gap-3.5`（14px），区块间距用 `gap-4.5`（18px）；`p-*` / `m-*` 与 gap 共用同一 4px 基线节奏。
- **content 检测**：由 Tailwind v4 自动检测 `index.html` 与 `src/**` 取代原 `content` glob，无需额外配置。

### 冻结规则（全局样式入口）

- `apps/web/src/styles/index.css` 与 `apps/web/src/styles/ios-theme.css` 是全局样式的**冻结入口**，不接收新增页面级选择器。
- 页面选择器归 `features/<domain>/styles/`，由该域 `index.ts` 导入；两个全局入口对页面级选择器保持冻结，新样式按组件目录或功能域目录新增。
- 拦截机制：stylelint 预算制（ratchet）冻结存量违规数、只拦净新增，用法见 [开发文档](docs/development/README.md) 的「样式治理」一节。

## Colors

整体调色板是 Apple 系统色在冷灰纸面上的克制组合：一个系统蓝强调色，一组石墨中性色，以及只用于状态反馈的语义色。

### Primary
- **System Blue** (`#007aff`；深色 `#0a84ff`)：当前导航项、主操作、链接、焦点环、选中控件和运行中状态。实心操作使用 `#0066cc`，按下使用 `#0055b3`，弱背景使用 `rgba(0, 122, 255, 0.12)`。
- **Blue Signal Rule**：蓝色只承担“当前 / 主要 / 可交互”的信号，不用于装饰性标题、图标底色或大面积背景。

### Secondary
- **Status Green** (`#34c759`；深色 `#30d158`)：成功、完成、已连接。
- **Status Amber** (`#ff9500`；深色 `#ff9f0a`)：警告、需要确认的中间态。
- **Status Red** (`#ff3b30`；深色 `#ff453a`)：错误、危险操作、不可逆动作。
- **Status Indigo** (`#5856d6`；深色 `#5e5ce6`)：信息、提示和中性强调。

游戏资源稀有度是唯一允许的领域色例外，但应封装在资源组件内部，不能扩散成页面主题。

### Neutral
- **Paper White** (`#ffffff` / `#f2f2f7`)：浅色卡片、页面和 chrome 的基准面。
- **Mist Gray** (`#e5e5ea` / `rgba(118, 118, 128, 0.12)`)：分组背景、弱容器、未选中控件和列表底。
- **Graphite Ink** (`#1c1c1e` / `#636366` / `#8e8e93`)：依次为主文字、次文字、辅助文字。
- **Midnight Glass** (`#000000` / `#1c1c1e`)：深色主题页面与卡片基底，不使用纯黑大面积铺满内容。
- **Hairline** (`rgba(60, 60, 67, 0.18)`；深色 `rgba(235, 235, 245, 0.18)`)：普通边框和分隔线；需要更明确分隔时使用 `border-strong`。

### Named Rules
**The One Accent Rule.** 系统蓝是唯一的品牌强调色。任一屏幕中，实心蓝色面积应保持克制；如果所有按钮、图标和标题都在抢蓝色，先删掉装饰性的那些。

**The Semantic Surface Rule.** 页面通过 `surface-panel`、`surface-soft`、`control-surface`、`control-active`、`brand-action`、`brand-text`、`status-*`、`form-error-*` 使用颜色，不直接写 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类页面级色板。

**The Dark Mirror Rule.** 深色主题不是浅色的机械反转：页面变为近黑石墨，文字变为暖白，蓝色略微提亮，但语义关系和强调色的稀缺性保持不变。不要在页面里另建一套深色 token。

## Typography

**Display Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif`
**Body Font:** 同一系统栈；中文与拉丁字符共用，不额外引入展示字体。
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`，只用于编号、时间戳、ID、日志和代码。

**Character:** 字体是“系统原生”的一部分，不表演个性。层级靠字号、字重和颜色（primary / secondary / tertiary）建立；中文标题和正文不增加字距，只有英文全大写微标签可以使用更宽字距。

### Hierarchy
- **Display / 页面标题** (600, `1.5rem` / `1.35`，移动端 `1.25rem`)：仅 `PageHeader` 的页面主标题。
- **Headline / 区块标题** (600, `1.125rem` / `1.45`)：`CardHeader`、主要内容区标题。
- **Title / 卡片标题** (600, `1rem` / `1.4`)：紧凑区块、列表分组和卡片内标题。
- **Body / 正文与表单标签** (400–500, `0.875rem` / `1.5`)：描述、输入标签、普通按钮；多行正文使用 `leading-6` 或 `1.6`。
- **Caption / 辅助说明** (400, `0.75rem` / `1.5`)：元数据、提示、筛选标签。
- **Meta / 微标签** (500, `0.6875rem` / `1.4`)：序号、时间戳、短 ID；`11px` 是正文类文字的下限。

### Named Rules
**The Four-Weight Rule.** 只使用 `400`、`500`、`600`、`700`。不要使用依赖系统字体插值的 `650`、`750`、`780`；需要更强层级时先检查字号和颜色，而不是继续加粗。

**The No-Tracking Rule.** 中文标题、正文和按钮不新增 letter spacing；只有英文全大写微标签可以使用更宽字距。

**The 11px Floor Rule.** `8px` 至 `10px` 不得承载中文正文、操作名或重要状态；`11px` 仅用于序号、时间戳和短元数据。

## Layout

布局模型是“固定工作台 + 弹性内容区”。`app-shell` 负责最大宽度和左右留白，页面内部不再嵌套同用途的 `max-w-*` 或水平 padding。

- 内容最大宽度 `1600px`（`100rem`）；桌面左右留白通常 `32px`，`1600px` 以上为 `40px`，移动端为 `14px`。
- 基础节奏为 4px。页面外层用 `app-page`，区块之间用 `app-stack-section` / `app-grid-section`，卡片内部用 `app-stack-card` / `app-grid-card`。
- 卡片内边距 `16px`；卡片内部紧密间距 `14px`（`gap-3.5`）；区块间距 `18px`（`gap-4.5`）；页面外层 `20px`，移动端 `14px`。不要用大量 `space-y-6`、`gap-6`、`p-6` 手写版式基准。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`。每一列都要有 `minmax(0, ...)` 或 `min-w-0`，避免长文本横向溢出。
- 阅读型长文本在自己的内容区单独限制行宽；不要把整页内容压成一条窄栏，也不要用 `max-w-7xl` 在 `app-shell` 内重复收窄。

### Responsive Shell

应用使用原生 `.la-pluma-app` 根节点。Navbar、页面区域、移动 tabbar 和 Sheet 等 chrome 与交互统一由 `Layout` 及 `shared/components` 通用组件提供；`styles/ios-theme.css` 负责 iOS 26 材质、应用 chrome、安全区和品牌适配，不要在页面中另起一套导航或 modal 基础样式。

- 桌面端（`lg` 及以上）显示 `17rem` 左侧工作台导航：一条跨越顶栏与导航区的连续圆角玻璃边界、可用搜索、单列导航和 28px 语义色图标底座；导航项从面板顶部开始排列，干员身份区固定在面板底部。当前项使用整行系统强调色和白色文字；品牌入口属于侧栏右侧的工作区顶栏，不能进入或遮挡侧栏圆角区。
- 移动端使用悬浮的 iOS 风格底部胶囊导航，右侧搜索/更多入口承载次要页面。两端必须复用 `Layout` 的 URL 路由和 active 状态，不要按 viewport 建立第二份导航状态。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 `.la-pluma-app`。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `apps/web/index.html` 使用 `viewport-fit=cover`。`Layout` 通过统一 token 管理 navbar、移动 tabbar 和对应安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- 页面边缘留白统一由 `Layout` 的 `.la-pluma-content` 提供，内部 `.app-page` 不重复增加上下内边距。桌面底部使用 `0.75rem`（12px）；移动端由外层预留底部导航、安全区和页面间距。
- 新页面按 mobile-first 编写：`sm` (640px) 用于显示次级信息或恢复横向工具栏，`md` (768px) 用于中等宽度布局，`lg` (1024px) 与 `xl` (1280px) 才扩展为双栏或多栏。不要新增 `899px`、`1023px` 这类页面级断点；日常页三栏等既有组件可保留自身的专用断点。
- 页面滚动条当前全局隐藏，避免切换页面或列表时因系统滚动条出现导致布局左右跳动。文本和控件要在移动端自然换行，不允许为了保留桌面布局而裁剪有效内容。

## Elevation & Depth

这是混合体系：普通内容面是平的，靠色阶和 1px 发丝线分层；只有 chrome、弹层、浮层和可点击卡片使用阴影或玻璃。深度不是装饰，而是“这一层是否浮在另一层之上”的答案。

### Shadow Vocabulary
- **Panel rest (light)** (`0 0 0 1px rgba(60, 60, 67, 0.18), 0 1px 3px rgba(15, 23, 42, 0.05), 0 14px 40px rgba(15, 23, 42, 0.05)`)：`surface-panel` 卡片和大面板的默认抬升。
- **Panel rest (dark)** (`inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(235, 235, 245, 0.18), 0 16px 40px rgba(0, 0, 0, 0.28)`)：深色主题的同等层级。
- **Glass chrome** (`0 12px 32px rgba(60, 60, 67, 0.12)`；深色 `0 14px 34px rgba(0, 0, 0, 0.34)`)：侧栏框、移动 tabbar 和悬浮 chrome。
- **Summoned layer** (`0 2px 8px rgba(0, 0, 0, 0.1), 0 30px 80px rgba(0, 0, 0, 0.24)`)：Modal、主题菜单、PWA 提示等被召唤的叠加层，配合 `blur(24px) saturate(165%)`。
- **Control rest** (`inset 0 0 0 1px rgba(60, 60, 67, 0.28), 0 1px 2px rgba(15, 23, 42, 0.025)`)：输入框、选择框和次级按钮的静态边界。

通用颜色、背景、阴影和变形过渡保持约 160–180ms；开关 thumb 使用 240ms。新增 CSS 或 Framer Motion 动效必须尊重 `prefers-reduced-motion`；玻璃层与阴影在 `prefers-reduced-transparency: reduce` 时退化为不透明表面；`prefers-contrast: more` 时加深边框和次级文字。

### Named Rules
**The Flat-By-Default Rule.** 普通卡片、列表和页面区块在静止状态保持平整。阴影只用于表达层级、可点击性或状态，不要给静态内容卡片加投影闪动或位移。

**The Liquid Glass Exception.** 只有 chrome、Modal、主题菜单、PWA 提示和明确的浮层可以使用 `backdrop-filter` 与深阴影。普通卡片保持不透明，避免整页都是玻璃导致可读性下降。

**The Single Beam Rule.** `status-border-beam` 仅用于启动、连接或执行中的局部状态反馈，并通过 `is-active` 控制；完成、空闲和静态卡片不得常驻光效，也不要叠加第二条可见边框。

## Shapes

形状语言来自 iOS 连续圆角：圆角足够柔和，但不做成大号“药丸卡片”。普通控件和卡片使用 `rounded-xl`（16px），需要 iOS 连续圆角视觉的卡片和面板使用 `SmoothSurface` / `SmoothPanel`（20px，紧凑 16px）。

- `rounded-sm`（8px）：细小元素、默认边界。
- `rounded-md`（10px）：checkbox、小控件、紧凑标签。
- `rounded-lg`（12px）：紧凑控件、列表项和局部容器。
- `rounded-xl`（16px）：卡片、面板、分段控件、通用按钮和输入。
- `--continuous-radius`（20px）：`SmoothPanel` 的标准连续圆角；紧凑版为 16px。
- `rounded-full`：胶囊、开关、头像和圆形状态点。

普通可见边框统一使用 `1px`，颜色使用 `var(--border)`；需要更明确分隔时使用 `var(--input)`。卡片、输入框、分段控件和普通信息容器不得按页面单独改成 `border-2` 或重色描边。`2px` 只用于复选框外框和勾选符号、层级引导线、加载圈等小尺寸控件的可辨识性；焦点环和阴影不是容器边框。

## Components

整体气质是**精密而克制**：控件像加工过的系统零件，尺寸和反馈都精确，但不以装饰、渐变或夸张动效吸引注意。

### Buttons
- **Shape:** `rounded-xl`（16px），无边框；`Button` 和 `IconButton` 共享高度档位。
- **Sizes:** `sm` 36px、`md` 44px、`lg` 48px；手机断点和粗指针设备把所有标准按钮、图标按钮与表单点击区提升到至少 44px。
- **Primary:** `brand-action`（`#0066cc` 实心、白字、轻微蓝色投影）；hover 只压暗，不增加渐变或光晕。
- **Secondary / Outline:** `control-surface` + `text-foreground`；hover 使用弱主题背景和轻描边。
- **Danger / Success:** `status-danger-action` / `status-success-action`，语义必须与操作后果一致。
- **Ghost:** 透明底 + `text-muted-foreground`；hover 只使用弱主题背景。
- **Focus:** `outline: 2px solid color-mix(in srgb, var(--primary) 62%, transparent)`，`outline-offset: 2px`；所有可点击元素都必须有明确的 `focus-visible` 状态。
- **Disabled / Loading:** disabled 使用 `opacity-50`、`cursor-not-allowed`，关闭点击与 hover；loading 期间自动禁用，仅显示加载指示器和 `loadingText`。不要在调用处叠加 `h-*`、`px-*`、`py-*` 缩小标准控件。

### Inputs / Fields
- **Style:** 44px 高、16px 圆角、`app-input control-surface`；静态边界使用 `inset 0 0 0 1px var(--input)` 和极轻的投影。
- **Focus:** `inset 0 0 0 1px var(--primary), 0 0 0 3px var(--primary-soft)`；不要用高饱和外发光。
- **Error:** `form-error-surface` 红色内描边，错误文字使用 `form-error-text`；`hint` 只在没有错误时显示。
- **Controls:** 二元启停使用 `Switch`（51×31px 胶囊，compact 41×25px）；多选或参数组合使用 `Checkbox`；新增表单优先使用 `Input`、`Select`、`Checkbox`、`Switch`，手写原生控件使用 `app-input control-surface`、`app-checkbox`。

### Cards / Containers
- **Corner Style:** 普通卡片 16px；需要连续圆角时使用 `SmoothPanel` 的 20px / 16px。
- **Background:** `surface-panel` 为主要卡片和大面板；`surface-soft` 为弱背景、状态条和次级容器。
- **Shadow Strategy:** 默认使用 `surface-panel` 的静止阴影；只有卡片本身可点击时才使用 `surface-panel-hover` 或启用 `Card hover`。
- **Border:** 1px 发丝线，不使用 `border-2`。
- **Internal Padding:** `16px`；`CardHeader` 使用 `14px 16px`，`CardContent` 使用 `16px`。
- 通用组件优先级：能用 `Card`、`CardHeader`、`CardContent`、`SmoothPanel` 时优先使用组件；特殊布局使用 `app-card surface-panel`、`app-card surface-soft`、`app-info-card`；不要把页面区块做成层层嵌套卡片。

### Navigation
- **Desktop:** 固定 17rem 侧栏，0.75rem 内缩的连续圆角玻璃框（`blur(28px) saturate(165%)`），单列导航、底部干员身份区和 28px 语义色图标底座；当前项为整行系统蓝和白色文字。
- **Mobile:** 悬浮 4rem 胶囊 tabbar，底部安全区由 `--la-pluma-tabbar-*` token 统一管理；右侧搜索/更多入口承载次要页面。
- **Shared State:** 两端复用 `Layout` 的 URL 路由和 active 状态；不要按 viewport 维护第二套导航状态，也不要让桌面侧栏样式扩散到移动底栏或“更多”Sheet。

### Modal / Dialog
- **Sizes:** `sm` `max-w-md`、`md` `max-w-lg`、`lg` `max-w-2xl`、`xl` `max-w-4xl`。
- **Surface:** 叠加层使用 `blur(24px) saturate(165%)` 和 summoned-layer 阴影；backdrop 为 `rgba(0, 0, 0, 0.42)` + `blur(10px)`。
- **Behavior:** 焦点陷阱、背景 `inert`、Esc 关闭、打开时锁定滚动、关闭后归还焦点；这些由 `Modal` 统一处理，页面不要自行实现。
- **ConfirmDialog:** 删除、清空等不可逆操作必须使用 `ConfirmDialog`，新代码不得使用 `window.confirm`。`onConfirm` 可以返回 Promise；返回 `false` 或抛出错误时弹窗保持打开，错误在弹窗内展示。

### Feedback
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

### Icons
- 普通功能图标优先使用已引入的 `lucide-react`；业务身份和概览图标优先复用 `Icons.tsx`。一级工作区标题与控制台一致，不添加装饰图标；不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。`icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标。
- 无文字操作使用 `IconButton`，调用时必须提供 `title` 和 `aria-label`；有文字的操作使用 `Button icon`，不要在调用处额外覆盖图标与文字间距或按钮尺寸。
- 装饰图标加 `aria-hidden="true"`；状态和结果必须同时提供可读文字或 `aria-label`，不能只依赖颜色和图标。

## Do's and Don'ts

### Do:
- **Do** 先读 `apps/web/src/styles/index.css` 和 `apps/web/src/styles/ios-theme.css`，再用语义类实现界面；新页面优先使用 `Layout`、`PageHeader`、`Card`、`Button`、`Input` 等现有组件。
- **Do** 把间距收敛到 Tailwind 原生档位与组件类、圆角收敛到 `--radius` 派生档位，保持 4px 基线和 1px 发丝线。
- **Do** 让系统蓝保持稀缺：只用于当前项、主操作、焦点和运行中状态；状态色只表达语义。
- **Do** 在手机和粗指针设备上保证至少 44px 的点击区域，并检查 light/dark、loading、disabled、empty、error 以及长标题/长操作文案。
- **Do** 在 `viewport-fit=cover` 的安全区设备上确认 chrome 与页面内容没有双重留白。
- **Do** 为所有可点击元素提供 `focus-visible` 状态，装饰图标加 `aria-hidden="true"`。

### Don't:
- **Don't** 新增页面级颜色主题或 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的色板；需要新语义时先在 `styles/index.css` 增加 token 或语义类。
- **Don't** 使用 `rounded-2xl`、`rounded-3xl` 或任意更大的圆角突破 `rounded-xl`；需要特殊造型时先确认是否应成为新的语义 token。
- **Don't** 给卡片、输入框、分段控件和普通信息容器使用 `border-2` 或重色描边；`2px` 只留给复选框、引导线和加载圈。
- **Don't** 在页面里重建导航壳层、主题开关、modal 基础样式或第二套组件 DOM。
- **Don't** 给普通按钮增加亮色渐变、强光晕或重投影；hover 只做主题色压暗或弱背景。
- **Don't** 把静态内容卡片做成层层嵌套，或为了填满留白硬塞第二张卡；独立工作区、弹窗、空状态和设备预览属于合理例外。
- **Don't** 使用 `window.confirm`、`8px`–`10px` 的中文正文，或 `899px`、`1023px` 这类页面级断点。
- **Don't** 让 `status-border-beam` 在完成、空闲或静态卡片上常驻，也不要叠加第二条可见边框。
