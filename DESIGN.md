---
name: La Pluma Next
description: 面向《明日方舟》自动化的本地 Web 控制台，使用 macOS 工作台结构、默认主题语义 token 与共享布局 token。
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
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
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
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
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

La Pluma Next 是一个高密度的本地自动化控制台，不是营销页面。它的界面首先是一张工作台：macOS 风格的固定侧栏负责工作区导航，中央区域承载任务编排、日志、数据和设备预览，移动端则退化为悬浮胶囊导航。所有控件都应当像加工过的系统控件：尺寸精确、反馈短促、层级清楚，不靠装饰制造存在感。

浅色主题读起来像冷调纸面与分层表面，深色主题则是近黑石墨与同一支蓝色信号。密度是刻意保留的：信息可以很满，但层级必须由字重、1px 发丝线和间距 token 建立，而不是由彩色卡片、渐变或投影堆出来。强调色是稀缺资源，只出现在当前导航项、主操作、焦点和运行中的状态上。

**Key Characteristics:**
- 原生语义优先：`Button`、`Input`、`Select`、`Checkbox`、`Switch`、`Card`、`Dialog`、`AlertDialog`、`Sheet` 使用 `shared/ui` 的 shadcn 生成物，`ConfirmAlertDialog`、`Loading` 等应用组件位于 `shared/components`；两者都使用真实语义元素，浏览器、jsdom、SSR 和嵌入式场景渲染一致。
- 单强调色：系统蓝承担品牌、主操作、焦点和选中态；状态色只表达成功、警告、危险和信息。
- 分层而不炫技：普通内容面保持平整，只有 chrome、弹层和可点击卡片使用抬升或 hover 阴影；玻璃由后续主题层提供。
- 4px 节奏：布局间距使用 Tailwind 原生档位与组件类；圆角使用 `--radius` 派生档位。
- 移动优先：断点从内容需要出发，不复制桌面布局，也不建立第二套导航状态。

### Source of Truth

- `apps/web/src/styles/index.css`：语义 token 的**唯一来源**（base 层）、Tailwind 入口、`@theme` 圆角派生与 `@theme inline` 颜色映射、通用组件类与跨域 keyframes；页面样式由各功能域自持。
- `apps/web/src/styles/layout.css`：结构几何与 `--layout-*` token（视口、navbar 与安全区高度、侧栏、内容宽度与留白、内容 sticky 顶部偏移、tabbar 安全区与浮动内容底部偏移）；应用 chrome 的尺寸、定位、网格、滚动宿主与 skip link 可访问性样式都在这里，不承载页面级颜色、材质或控件外观。
- `apps/web/src/styles/ios-theme.css`：只保留默认主题的 chrome 材质 token（`--glass-*`）与对应视觉样式；默认基线不依赖玻璃材质，液态玻璃由后续主题提供。
- `apps/web/src/shared/components`：`PageShell`、`ConfirmAlertDialog`、`EmptyState`、`Loading` 等应用级通用组件；`Button`、`Input`、`Select`、`Checkbox`、`Switch`、`Card`、`Dialog`、`AlertDialog`、`Sheet` 等 shadcn 生成物位于 `apps/web/src/shared/ui`（sidebar 也在该目录）。

本文件描述规则；语义 token 的具体数值以 `apps/web/src/styles/index.css` 为准，布局与结构几何 token 以 `apps/web/src/styles/layout.css` 为准，chrome 材质 token 以 `apps/web/src/styles/ios-theme.css` 为准。调整 token 时同步更新本文件的表格与说明。

## 层序与 token 单源

`apps/web/src/styles/index.css` 首行先声明完整层序，再导入 Tailwind：

```css
@layer theme, base, components, page, utilities;
@import "tailwindcss";
```

- **utilities 永远赢**：`page` 位于 `components` 之后、`utilities` 之前；页面 CSS 可以覆盖 base/preflight 与 components，但普通声明不再压过 utilities。确实需要压过 utilities 的页面/组件规则使用 `!important` 并在原位注释原因。
- **page 层**：每个功能域自持自己的页面样式，放在 `features/<domain>/styles/<domain>.css`，由该域 `index.ts` 导入一次，全部位于 `@layer page`；`index.css` 只保留跨域 keyframes，`layout.css` 只保留应用壳层的布局几何与结构 token，`ios-theme.css` 只保留应用 chrome 材质与跨域 page-kind 材质（`[data-page-layout="workspace"]`、`[data-page-surface="borderless"]`、`.la-pluma-content` 控件、浮层）；automation 的 `[data-page-kind="automation"]` 材质归 `features/automation/styles/automation.css` 自持；通用组件类留在 `@layer components`。
- **域内 CSS 按普通 CSS 处理**：功能域样式文件不经过 Tailwind 入口的编译与降级流水线，不要在其中使用 `@apply`/`@theme` 等 Tailwind 指令；需要厂商前缀的能力按现有写法显式补齐（如 `-webkit-backdrop-filter`），浏览器下限仍以 v4 目标为准。
- **token 单源**：语义 token（颜色、圆角、间距、字号、控件高度等）只在 `index.css` 的 `:root` / `html.dark, #app-root.dark` / 媒体查询中定义一次；结构布局 token（`--layout-*`）只由 `layout.css` 定义。浅色、深色、`prefers-contrast`、`prefers-reduced-transparency` 的最终生效值都写在这里；`ios-theme.css` 不再出现同名重定义。
- **深色切换**：主题仍同时给 `html` 与 `#app-root` 加 `.dark`；`html.dark` 与 `#app-root.dark` 都保留为有效选择器。

## 档位即规范（Tailwind 原生尺度）

应用直接使用 Tailwind v4 原生档位，不做压缩映射或定向重映射。

- **圆角**：由 `index.css` 的 `--radius: 0.75rem` 经标准派生得到常用四档——`rounded-sm` = `calc(var(--radius) - 4px)`（8px）、`rounded-md` = `- 2px`（10px）、`rounded-lg` = `var(--radius)`（12px）、`rounded-xl` = `+ 4px`（16px）；`rounded-2xl`、`rounded-3xl` 等更大档位沿用 v4 默认静态值，胶囊用 `rounded-full`。
- **间距**：沿用 v4 动态 spacing 尺度的 .5 步进，卡片内紧密间距用 `gap-3.5`（14px），区块间距用 `gap-4.5`（18px）；`p-*` / `m-*` 与 gap 共用同一 4px 基线节奏。
- **content 检测**：由 Tailwind v4 自动检测 `index.html` 与 `src/**` 取代原 `content` glob，无需额外配置。

### 冻结规则（全局样式入口）

- `apps/web/src/styles/index.css`、`apps/web/src/styles/layout.css` 与 `apps/web/src/styles/ios-theme.css` 是全局样式的**冻结入口**，不接收新增页面级选择器。
- 页面选择器归 `features/<domain>/styles/`，由该域 `index.ts` 导入；上述全局入口对页面级选择器保持冻结，新样式按组件目录或功能域目录新增。
- 拦截机制：stylelint 预算制（ratchet）冻结存量违规数、只拦净新增，用法见 [开发文档](docs/development/README.md) 的「样式治理」一节。

## Colors

整体调色板是 Apple 系统色在冷灰纸面上的克制组合：一个系统蓝强调色，一组石墨中性色，以及只用于状态反馈的语义色。

### Primary
- **System Blue** (`#007aff`；深色 `#0a84ff`)：当前导航项、主操作、链接、焦点环、选中控件和运行中状态。按钮主操作使用 shadcn `bg-primary`（即上述 System Blue，hover 为 `bg-primary/80`）；`.brand-action` 实心表面使用 `#0066cc`，按下 `#0055b3`，用于分段控件等应用自绘表面；弱背景使用 `rgba(0, 122, 255, 0.12)`。
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

**The Semantic Surface Rule.** 页面通过 `Card` 语义 token、`surface-panel`、`surface-soft`、`control-surface`、`control-active`、`brand-action`、`brand-text`、`status-*`、`form-error-*` 使用颜色，不直接写 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类页面级色板。

**The Dark Mirror Rule.** 深色主题不是浅色的机械反转：页面变为近黑石墨，文字变为暖白，蓝色略微提亮，但语义关系和强调色的稀缺性保持不变。不要在页面里另建一套深色 token。

## Typography

**Display Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF UI Text", system-ui, sans-serif`
**Body Font:** 同一系统栈；中文与拉丁字符共用，不额外引入展示字体。
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`，只用于编号、时间戳、ID、日志和代码。

**Character:** 字体是“系统原生”的一部分，不表演个性。层级靠字号、字重和颜色（primary / secondary / tertiary）建立；中文标题和正文不增加字距，只有英文全大写微标签可以使用更宽字距。

### Hierarchy
- **Page title / chrome 页面标题** (600, `1.5rem` / `1.35`)：顶栏唯一的 `h1`，直接使用当前工作区名称；桌面与移动端同字号，`document.title` 使用同一来源，页面内不再重复页头。
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

布局模型是“固定工作台 + 弹性内容区”。横向宽度与留白只由布局 token 控制，`.la-pluma-content` 与 `.la-pluma-navbar-inner` 共用同一份最大宽度、居中与左右 padding；页面内部不再嵌套同用途的 `max-w-*` 或水平 padding。

页面根统一由 `shared/components` 的 `PageShell` 提供：根节点输出 `data-region="page"` 与 `data-page-kind`，工作台页追加 `data-page-layout="workspace"`，无边框卡片页追加 `data-page-surface="borderless"`；`PageShell` 内部固定一个 `app-stack-section`，页面只提供内容，不自建标题或页头。布局、视觉与浏览器测试通过 `data-region` / `data-page-*` 定位，不依赖实现类名。

- 应用壳的稳定 region 锚点：`page`、`page-header`、`page-title`、`page-content`、`scroll`、`monitor`、`toolbar`、`navbar`、`sidebar`、`tabbar`；滚动宿主固定为 `[data-region="scroll"]`。
- 内容最大宽度 `112rem`（`--layout-content-max`），两侧对称居中。
- 页面左右留白由 `--layout-page-gutter` 提供：桌面（`1024px` 及以上）`32px`；平板（`640px` 及以上且小于 `1024px`）`20px`；移动（小于 `640px`）`14px`。安全区取 `max(gutter, env(safe-area-inset-*))`，不叠加第二份 inset。
- 基础节奏为 4px。页面外层用 `app-page`，区块之间用 `app-stack-section` / `app-grid-section`，卡片内部用 `app-stack-card` / `app-grid-card`。
- 卡片内边距 `16px`；卡片内部紧密间距 `14px`（`gap-3.5`）；区块间距 `18px`（`gap-4.5`）；页面外层 `20px`，移动端 `14px`。不要用大量 `space-y-6`、`gap-6`、`p-6` 手写版式基准。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`。每一列都要有 `minmax(0, ...)` 或 `min-w-0`，避免长文本横向溢出。
- 阅读型长文本在自己的内容区单独限制行宽；不要把整页内容压成一条窄栏，也不要在内容容器内重复收窄整页宽度。

### Responsive Shell

应用使用原生 `.la-pluma-app` 根节点。Navbar、侧栏、页面区域、移动 tabbar 和 Sheet 等 chrome 与交互统一由 `Layout` 及 `shared/components` 通用组件提供；`styles/layout.css` 提供主题无关的布局几何与安全区 token，`styles/ios-theme.css` 负责默认主题下的应用 chrome 材质，不要在页面中另起一套导航或 modal 基础样式。液态玻璃是后续主题能力，不属于默认 chrome。

- 桌面端（`1024px` 及以上）显示 `17rem` 左侧工作台：顶部是侧栏品牌头（普通非交互标识，不是按钮或链接），其下是单列工作区导航，底部固定干员身份区与每日语录。当前项使用侧栏强调背景与中等字重，不使用整行实心蓝。
- 顶栏固定为两列：页面标题在左（唯一 `h1`，来自当前工作区名称并可截断），操作区在右。页面不再渲染自己的标题、副标题或页头操作区。
- 移动端隐藏侧栏与品牌，顶栏仍保留页面标题与操作区；底部使用悬浮胶囊导航，右侧“更多”入口承载次要页面。两端必须复用 `Layout` 的 URL 路由和 active 状态，不要按 viewport 建立第二份导航状态。
- 页面内提供 skip links：`跳到主要内容` 指向 `#main-content`；`跳到主导航` 在桌面（`1024px` 及以上）指向侧栏 `#app-sidebar-navigation`，在移动/平板指向 tabbar `#app-tabbar-navigation`。链接默认移出视口，`:focus` 时固定显示在左上角并避开安全区；未聚焦时不占布局，不可用的那一个在对应断点 `display: none`，不进入焦点顺序。
- 路由 pathname 变化后，焦点移到 `<main id="main-content" tabIndex="-1">`，并通过常驻的 `#page-announcement`（`role="status"`、`aria-live="polite"`、`aria-atomic="true"`）播报 `已切换到<页面名>`。首次挂载不聚焦、不播报；启动期 URL 归一化（replace）同样不触发。当前焦点位于 `role="dialog"` / `role="alertdialog"` 内时不抢焦点。`document.title` 继续使用同一页面标题源。
- 移动 tabbar 的 `<footer>` 保持在 `<main>` 之后，以维持 landmark 与阅读顺序；不要为了 DOM 顺序把 footer 移到 main 之前，直达导航由 `跳到主导航` skip link 提供。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 `.la-pluma-app`。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `apps/web/index.html` 使用 `viewport-fit=cover`。`Layout` 通过统一 token 管理 navbar、移动 tabbar 和对应安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- `--layout-navbar-safe-height` 等于 navbar 高度加顶部安全区，是 navbar 最小高度、滚动宿主高度、内容顶部留白与滚动遮罩的共同来源；页面样式不要手写 navbar 高度或重新拼接 `env(safe-area-inset-top)`。
- 内容 sticky 顶部偏移统一使用 `--layout-content-sticky-top`：桌面为 `1rem`，移动/平板壳层（小于 `1024px`，navbar 覆盖滚动宿主）为 `calc(var(--layout-navbar-safe-height) + 1rem)`。移动壳层内的 sticky 内容从 navbar 与安全区之下开始，滚动时保持在 tabbar 预留区域之上，不进入尾部渐隐遮罩。
- 页面边缘留白统一由 `Layout` 的 `.la-pluma-content` 提供，内部 `.app-page` 不重复增加上下内边距。桌面底部使用 `0.75rem`（12px）；移动端由外层预留底部导航、安全区和页面间距。
- 浮动内容的底部偏移统一使用 `--layout-floating-bottom-offset`：它等于 `--layout-tabbar-reserved-height`（已包含一次底部安全区）加 `1rem`。移动/平板壳层（小于 `1024px`）的 toast、PWA 安装提示、安装入口与更新条直接消费该 token，不再另加 `env(safe-area-inset-bottom)`，也不用 `5rem` 等固定值近似 tabbar 几何。
- `apps/web/index.html` 的启动壳在应用 CSS 加载前独立渲染，保留 `--boot-navbar-height` 与 `--boot-bottom-clearance` 的本地副本；二者必须分别等于 `--layout-navbar-height` 与 `--layout-tabbar-bottom-clearance`，启动壳 header 使用 navbar 高度加顶部安全区。启动壳与真实 navbar 的几何一致性由 `layout.test.ts` 和浏览器测试守住，React 接管时不得发生首帧高度跳变。
- 新页面按 mobile-first 编写：`sm` 用于显示次级信息或恢复横向工具栏，`md` 用于中等宽度布局，`lg` 与 `xl` 才扩展为双栏或多栏。所有视口断点必须来自下方 Breakpoints 表，不要新增未登记阈值；日常页三栏等既有组件使用表中已登记的专用断点。
- 页面滚动条当前全局隐藏，避免切换页面或列表时因系统滚动条出现导致布局左右跳动。文本和控件要在移动端自然换行，不允许为了保留桌面布局而裁剪有效内容。

#### Viewport Contract

- **应用壳**：普通浏览器使用 `100dvh`，跟随地址栏收放；`display-mode: standalone`、`display-mode: fullscreen` 与 `html.la-pluma-standalone` 使用 `100lvh`，让固定导航贴住物理屏幕边缘。`--layout-viewport-height` 是壳层视口高度的唯一来源，启动壳的 `--boot-viewport-height` 保持同样的分支。
- **能力兜底**：不支持 `dvh` 时回退到 `100vh`，不支持 `lvh` 时同样回退到 `100vh`；`dvh` 兜底位于 standalone 的 `lvh` 覆盖之前，`lvh` 兜底保留在最后，顺序保证缺少对应能力时仍落到 `vh`。
- **弹层**：需要限制高度的 Dialog 使用 `--layout-dialog-max-height`（`calc(100dvh - 2rem)`），移动 Sheet 使用 `--layout-sheet-max-height`（`85dvh`）；该 token 只服务于确有高度上限的弹层，不是所有 Dialog 的默认约束。两者都带 `vh` 兜底，弹层不手写裸 `dvh` 高度。
- **局部例外**：`ios-theme.css` 的 more-sheet 使用 `min(28rem, 78dvh)` 并前置 `78vh` 兜底；`ScrcpyDeviceView` 沉浸层是已登记的局部例外，使用 `h-dvh w-screen`，按设备画面自身的全屏契约处理，不使用壳层 token。两者都登记在静态契约 allowlist 中，不扩散到其他页面或弹层。
- **页内固定块**：日志控制台这类随页面滚动的固定高度内容使用 `svh`，并前置 `vh` 兜底，不随地址栏伸缩改变高度；只有壳层和弹层消费 `dvh`/`lvh`。
- **软键盘**：viewport meta 声明 `interactive-widget=resizes-content`，它是面向移动端软键盘的视口声明；支持范围随渲染引擎与版本变化，桌面 Chrome/Edge/Firefox 不支持该声明，Safari/iOS 与 Firefox for Android 仅部分较新版本支持。仓库未在真机验证软键盘行为，不能视为跨平台生效。改动时保留 `width=device-width`、`initial-scale=1.0` 与 `viewport-fit=cover`。

#### Breakpoints

| 名称 | 阈值 | 用途 |
| --- | --- | --- |
| `sm` | 640px | 手机/平板分界；显示次级信息或恢复横向工具栏（Tailwind 默认） |
| `md` | 768px | 平板中等宽度布局（Tailwind 默认） |
| `workbench` | 900px | 自动化双列工作台；CSS 与 TSX 共用同一阈值 |
| `lg` | 1024px | 桌面壳层：显示侧栏、隐藏移动 tabbar（Tailwind 默认） |
| `flow-card` | 1200px | 自动化流程卡头部转为纵向密度 |
| `xl` | 1280px | 宽屏内容网格：概览双栏与汇总网格、养成分栏（Tailwind 默认） |
| `wide` | 1360px | 三列工作台：自动化/作业/肉鸽/设备画面 |

- 同一阈值只用成对区间表达：`width < Npx` 与 `width >= Npx`。禁止用 `max-width: N` 与 `min-width: N` 成对表达同一阈值，也不使用 `max-width: 1279px` 这类补偿值。
- CSS 使用区间语法，跨区间写 `(768px <= width < 1280px)`；JS `matchMedia` 用 `apps/web/src/shared/lib/breakpoints.ts` 的 `BREAKPOINTS` 生成同样的区间查询。`sm`/`md`/`lg`/`xl` 使用 Tailwind 默认具名变体，`workbench` 由 `@theme` 添加；`flow-card`/`wide` 仅用于 CSS 媒体查询。
- `apps/web/src/styles/breakpoints.test.ts` 静态审计直接 `matchMedia` 调用（含括号、断言、非空与元素访问写法）；先保存为别名再调用、或字符串内嵌的 `matchMedia` 不在静态审计范围（启动脚本内嵌查询不是宽度断点）。命名 Tailwind 变体只允许 `sm`/`md`/`lg`/`xl`/`workbench` 及其派生；`2xl` 与未登记的 `--breakpoint-*` 由守卫拒绝，唯一登记项 `--breakpoint-workbench` 必须定义在 `styles/index.css` 且值与 `BREAKPOINTS.workbench` 一致。源码文本扫描可能对注释或普通字符串中的 `2xl:` 报错。
- `@container` 查询由容器内容驱动，不属于视口断点，不受此表约束。
- 新增专用断点必须先在此表登记用途与内容依据，优先评估容器查询；未登记的 `min-[Npx]` / `max-[Npx]` arbitrary 断点不允许出现。
- 壳层结构几何断点（内容留白、navbar、tabbar 的切换）由 `styles/layout.css` 拥有；其他全局样式只能复用批准阈值，不得新增壳层阈值。

## Elevation & Depth

这是混合体系：普通内容面是平的，靠色阶和 1px 发丝线分层；只有 chrome、弹层、浮层和可点击卡片使用阴影。深度不是装饰，而是“这一层是否浮在另一层之上”的答案。默认基线以语义表面与发丝线构成 chrome，液态玻璃材质由后续主题层提供。

### Shadow Vocabulary
- **Panel rest (light)** (`0 0 0 1px rgba(60, 60, 67, 0.18), 0 1px 3px rgba(15, 23, 42, 0.05), 0 14px 40px rgba(15, 23, 42, 0.05)`)：`surface-panel` 召唤层与独立面板的默认抬升。
- **Panel rest (dark)** (`inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(235, 235, 245, 0.18), 0 16px 40px rgba(0, 0, 0, 0.28)`)：深色主题的同等层级。
- **Glass chrome** (`0 12px 32px rgba(60, 60, 67, 0.12)`；深色 `0 14px 34px rgba(0, 0, 0, 0.34)`)：仅用于液态玻璃主题下的移动 tabbar 与悬浮 chrome，默认基线不启用。
- **Summoned layer** (`0 2px 8px rgba(0, 0, 0, 0.1), 0 30px 80px rgba(0, 0, 0, 0.24)`)：Dialog/Sheet、主题菜单、PWA 提示等被召唤的叠加层，配合 `blur(24px) saturate(165%)`。
- **Control rest** (`inset 0 0 0 1px rgba(60, 60, 67, 0.28), 0 1px 2px rgba(15, 23, 42, 0.025)`)：输入框、选择框和次级按钮的静态边界。

通用颜色、背景、阴影和变形过渡保持约 160–180ms；开关 thumb 使用 240ms。新增 CSS 或 Framer Motion 动效必须尊重 `prefers-reduced-motion`；玻璃层与阴影在 `prefers-reduced-transparency: reduce` 时退化为不透明表面；`prefers-contrast: more` 时加深边框和次级文字。

### Named Rules
**The Flat-By-Default Rule.** 普通卡片、列表和页面区块在静止状态保持平整。阴影只用于表达层级、可点击性或状态，不要给静态内容卡片加投影闪动或位移。

**The Liquid Glass Theme.** 液态玻璃是后续主题层的能力，不属于默认 chrome。shell chrome 的玻璃材质由后续主题提供；现有分段控件与召唤层（Dialog/Sheet、主题菜单、PWA 提示等）的材质保持不变。普通卡片始终不透明，避免整页都是玻璃导致可读性下降。

**The Single Beam Rule.** `status-border-beam` 仅用于启动、连接或执行中的局部状态反馈，并通过 `is-active` 控制；完成、空闲和静态卡片不得常驻光效，也不要叠加第二条可见边框。

## Shapes

形状语言来自 iOS 连续圆角：圆角足够柔和，但不做成大号“药丸卡片”。卡片和面板使用 `rounded-xl`（16px），Button、Input、Select 等表单控件使用 `rounded-lg`（12px）。基线组件保持普通圆角；连续曲率只由玻璃主题皮肤层以纯 CSS `corner-shape` 提供，不支持的浏览器降级为普通圆角。

- `rounded-sm`（8px）：细小元素、默认边界。
- `rounded-[4px]`：Checkbox。
- `rounded-md`（10px）：小控件、紧凑标签。
- `rounded-lg`（12px）：Button、Input、Select 等表单控件、紧凑控件、列表项和局部容器。
- `rounded-xl`（16px）：卡片、面板、分段控件。
- `--continuous-radius`（20px）：玻璃主题连续曲率的参考半径。
- `rounded-full`：胶囊、开关、头像和圆形状态点。

普通可见边框统一使用 `1px`，颜色使用 `var(--border)`；需要更明确分隔时使用 `var(--input)`。卡片、输入框、分段控件和普通信息容器不得按页面单独改成 `border-2` 或重色描边。`2px` 只用于复选框外框和勾选符号、层级引导线、加载圈等小尺寸控件的可辨识性；焦点环和阴影不是容器边框。

## Components

整体气质是**精密而克制**：控件像加工过的系统零件，尺寸和反馈都精确，但不以装饰、渐变或夸张动效吸引注意。

### Buttons
- **Shape:** `rounded-lg`（12px），无边框；`Button` 的尺寸档位由 shadcn base-nova 提供。
- **Sizes:** `xs` 24px、`sm` 28px、`default` 32px、`lg` 36px；图标档 `icon-xs` 24px、`icon-sm` 28px、`icon` 32px、`icon-lg` 36px。手机断点和粗指针设备沿用同一紧凑档位，不额外放大。
- **Primary:** shadcn `bg-primary`（浅色 `#007aff`、深色 `#0a84ff`、白字）；hover 使用 `bg-primary/80`，不增加渐变或光晕。
- **Secondary / Outline:** Secondary 使用 `bg-secondary`；Outline 使用 `border-border bg-background`，hover 使用 `bg-muted`。
- **Danger:** 使用 `destructive` variant（`bg-destructive/10` + `text-destructive`），语义必须与操作后果一致。
- **Ghost:** 透明底、文字继承 `foreground`；hover 使用 `bg-muted`。
- **Focus:** `focus-visible:border-ring` 与 `focus-visible:ring-3 focus-visible:ring-ring/50`；所有可点击元素都必须有明确的 `focus-visible` 状态。
- **Disabled / Loading:** disabled 使用 `pointer-events-none`、`opacity-50`，关闭点击与 hover；loading 由调用点用 `disabled` + `aria-busy` 表达，并以 `LoaderCircle` 和进行中文案替换内容。不要在调用处叠加 `h-*`、`px-*`、`py-*` 缩小标准控件。

### Inputs / Fields
- **Style:** 32px 高（`h-8`）、`rounded-lg`（12px）的 shadcn `Input`；`bg-transparent`、边框与状态色使用 shadcn 语义 token，深色模式由生成物的 `dark:bg-input/30` 叠加。
- **Focus:** `focus-visible:border-ring` 与 `focus-visible:ring-3 focus-visible:ring-ring/50`；不要用高饱和外发光。
- **Error:** `aria-invalid` 触发 destructive 边框与 ring，错误文本使用 `form-error-text`；字段说明由 feature field helper 或 `FieldHint` 承担，原语没有 `hint` prop。
- **Controls:** 二元启停使用 `Switch`（默认 32×18.4px 胶囊，`sm` 24×14px）；多选或参数组合使用 `Checkbox`（16×16px）；新增表单直接使用 `@/shared/ui` 的 `Input`、`Select`、`Checkbox`、`Switch`，字段行由 feature field helper 组合标签、错误与说明。`autoComplete="off"` 由消费点或 field helper 显式传入，生成原语没有该默认值。

### Cards / Containers
- **Corner Style:** shadcn `Card` 使用 `rounded-xl`（16px）；连续曲率只由玻璃主题皮肤层提供。
- **Background:** `Card` 的 `bg-card` 为主要卡片与面板；`surface-soft` 为弱背景、状态条和次级容器；`surface-panel` 保留给主题菜单与 PWA 提示等应用自绘召唤层。
- **Shadow Strategy:** 静止卡片使用 `Card` 的 1px ring；只有卡片本身可点击时才使用 `surface-panel-hover`。召唤层使用 `surface-panel` 的静止阴影。
- **Border:** 1px 发丝线，不使用 `border-2`。
- **Internal Padding:** 卡片使用 shadcn `--card-spacing`（默认 16px，`size="sm"` 为 12px）；分节自持内边距的面板给 `Card` 加 `gap-0 p-0!`。
- 通用组件优先级：能用 `Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardAction`、`CardContent`、`CardFooter` 时优先使用组合；特殊布局使用 `surface-soft`、`app-info-card`；不要把页面区块做成层层嵌套卡片。

### Navigation
- **Desktop:** 固定 17rem 侧栏；顶部 `SidebarHeader` 承载非交互品牌标识，其下是单列工作区导航，底部固定干员身份区与每日语录。当前项使用侧栏强调背景与中等字重，不使用整行实心蓝；侧栏不使用玻璃框、搜索或图标底座。
- **Mobile:** 悬浮 4rem 胶囊 tabbar，底部安全区由 `--layout-tabbar-*` token 统一管理；右侧“更多”入口经 Sheet 承载次要页面。移动端隐藏侧栏与品牌，顶栏仍显示页面标题。
- **Shared State:** 两端复用 `Layout` 的 URL 路由和 active 状态；不要按 viewport 维护第二套导航状态，也不要让桌面侧栏样式扩散到移动底栏或“更多”Sheet。

### Dialog / Sheet
- **Sizes:** 组合生成原语时按内容选择 `sm:max-w-md`、`sm:max-w-lg`、`sm:max-w-2xl`、`sm:max-w-4xl`；确认框使用 `AlertDialog` 的默认宽度。
- **Surface:** 使用 shadcn 生成物的 `bg-popover`、ring 与阴影；遮罩由 `DialogOverlay` 或 `Sheet` 原语提供。
- **Behavior:** 焦点陷阱、背景 `aria-hidden`、Esc 关闭、打开时锁定滚动、关闭后归还焦点由 Base UI 原语处理，页面不要自行实现；嵌套弹层按 React 父子关系组合。
- **AlertDialog:** 删除、清空等不可逆操作必须使用 `AlertDialog` 或应用层 `ConfirmAlertDialog`，新代码不得使用 `window.confirm`。`onConfirm` 可以返回 Promise；返回 `false` 或抛出错误时弹窗保持打开，错误在弹窗内展示。

### Feedback
按下面顺序选择反馈方式，不要用空状态伪装错误，也不要为同一结果重复显示多种提示：

| 情况 | 使用方式 |
| --- | --- |
| 字段校验失败 | 字段行由 feature field helper 传 `aria-invalid` 与错误文本；说明由 helper 或 `FieldHint` 承担，错误显示时不叠加说明 |
| 控制台首次且没有本地缓存 | 控制台内部的 `DashboardSkeleton`；恢复或返回页面时先显示最后一次成功快照并后台刷新，不要重播整页骨架 |
| 局部内容正在读取 | `Loading` |
| 列表、流程或卡片无数据 | `EmptyState`，按容器选择 `compact` |
| 区域读取失败 | 在原区域显示可恢复的错误与重试操作；不要改成空状态 |
| 全局结果与错误 | `notify`（sonner `AppToaster`）；错误常驻到关闭，其他类型按默认时长收起，最多同时显示 3 条。同一流程使用固定 id 复用通知（`execution`、`statistics`、`settings-update`、`settings-update-channel`、`settings-auto-update`、`settings-config:connection`、`settings-config:instance`、`settings-config:resource-source`、`combat-preview`、`combat-queue-preview`、`combat-paradox-search`），进度用 `notifyProgress`；有终态文案时用同一 id 替换，没有终态文案时才 `dismissNotice` |
| 删除、清空等不可逆操作 | 使用 `AlertDialog` 或应用层 `ConfirmAlertDialog`；新代码不得使用 `window.confirm` |

日志控制台、养成筛选空结果等固定高度或高密度区域可保留专用状态样式。局部表单成功提示、日志提示等需要紧邻操作区或可手动关闭时，也可保留在面板内。全局通知统一走 `shared/notifications` 的 `notify`、`notifyProgress` 与 `dismissNotice`，由应用根挂载的 sonner `AppToaster` 渲染；撤销提示使用 `UndoToastCard`，不要让页面自建第二套 toast。

### Icons
- 普通功能图标优先使用已引入的 `lucide-react`；业务身份和概览图标优先复用 `Icons.tsx`。一级工作区标题与控制台一致，不添加装饰图标；不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。`icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标。
- 无文字操作使用 Button 的 `size="icon"`（`icon-xs`/`icon-sm`/`icon`/`icon-lg`），调用时必须提供 `title` 和 `aria-label`；有文字的操作把图标作为 children 传入并加 `aria-hidden="true"`，图标尺寸由生成组件的内建规则处理，不要在调用处额外覆盖图标与文字间距或按钮尺寸。
- 装饰图标加 `aria-hidden="true"`；状态和结果必须同时提供可读文字或 `aria-label`，不能只依赖颜色和图标。

## Do's and Don'ts

### Do:
- **Do** 先读 `apps/web/src/styles/index.css`、`apps/web/src/styles/layout.css` 和 `apps/web/src/styles/ios-theme.css`，再用语义类实现界面；新页面优先使用 `Layout`、`Card`、`Button`、`Input` 等现有组件。
- **Do** 把间距收敛到 Tailwind 原生档位与组件类、圆角收敛到 `--radius` 派生档位，保持 4px 基线和 1px 发丝线。
- **Do** 让系统蓝保持稀缺：只用于当前项、主操作、焦点和运行中状态；状态色只表达语义。
- **Do** 在手机和粗指针设备上沿用 shadcn base-nova 的紧凑控件度量，不额外放大表单控件，并检查 light/dark、loading、disabled、empty、error 以及长标题/长操作文案。
- **Do** 在 `viewport-fit=cover` 的安全区设备上确认 chrome 与页面内容没有双重留白。
- **Do** 为所有可点击元素提供 `focus-visible` 状态，装饰图标加 `aria-hidden="true"`。

### Don't:
- **Don't** 新增页面级颜色主题或 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的色板；需要新语义时先在 `styles/index.css` 增加 token 或语义类。
- **Don't** 使用 `rounded-2xl`、`rounded-3xl` 或任意更大的圆角突破 `rounded-xl`；需要特殊造型时先确认是否应成为新的语义 token。
- **Don't** 给卡片、输入框、分段控件和普通信息容器使用 `border-2` 或重色描边；`2px` 只留给复选框、引导线和加载圈。
- **Don't** 在页面里重建导航壳层、主题开关、modal 基础样式或第二套组件 DOM。
- **Don't** 给普通按钮增加亮色渐变、强光晕或重投影；hover 只做主题色压暗或弱背景。
- **Don't** 把静态内容卡片做成层层嵌套，或为了填满留白硬塞第二张卡；独立工作区、弹窗、空状态和设备预览属于合理例外。
- **Don't** 使用 `window.confirm`、`8px`–`10px` 的中文正文，或 Breakpoints 表之外的页面级断点与 `min-[Npx]` / `max-[Npx]` arbitrary 断点。
- **Don't** 让 `status-border-beam` 在完成、空闲或静态卡片上常驻，也不要叠加第二条可见边框。
