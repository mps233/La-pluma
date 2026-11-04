# 通用组件库与设计规范

## 概述

为了统一界面质量、减少重复代码和提升开发效率，项目维护一套通用 UI 组件和语义设计 token。通用组件位于 `client/src/components/common/*.tsx`，通过 `client/src/components/common/index.ts` 统一导出。

设计系统的代码来源：

- `client/src/ios-theme.css`：**实际生效的主题层**。它在 `main.tsx` 中晚于 `index.css` 加载，且不在 `@layer` 中，因此它的 `:root` 会覆盖调色板、圆角、间距、控件高度和字体族。
- `client/src/index.css`：基础/回退层，定义 `--app-font-*`、4px 基础间距、语义类和组件样式。
- `client/tailwind.config.ts`：把常用 `rounded-*`、`gap-*`、`space-*` 映射到 token。
- `client/src/components/common`：页面标题、卡片、按钮、输入、弹窗、加载等通用组件。

token 权威表：

| 家族 | 最终生效 | 说明 |
| --- | --- | --- |
| 颜色、表面、状态 | `ios-theme.css` 的 `:root` / `html.dark` | `index.css` 的值是回退；改品牌色必须同时改 `ios-theme.css` |
| 字体族 | `ios-theme.css` | `--app-font-family` |
| 字号 | `index.css` 的 `--app-font-*` | `ios-theme.css` 另有 `.app-page-title` 的尺寸覆盖 |
| 圆角 | `ios-theme.css` | `--app-radius-*`；连续圆角见「圆角」节 |
| 基础间距 1–6 | `index.css` | 4px 基线 |
| 语义间距 card / section / page / panel / control-x | `ios-theme.css` | 移动端在 ≤639px 覆盖全部语义间距，见「间距」 |
| 控件高度 | `ios-theme.css` | 桌面 36 / 44 / 48px；`index.css` 的 36 / 40 / 44px 是回退 |
| 内容宽度、桌面留白 | `ios-theme.css` | `.la-pluma-content` 的 112rem 与 1.25 / 2rem |
| 阴影 | 通用卡片/菜单/弹层没有 elevation token；chrome 有专用 token | 按「阴影」表使用现有类；chrome 用 `--app-glass-shadow` / `--la-pluma-tabbar-shadow` / `--la-pluma-sidebar-frame-shadow` |

---

## 原生响应式壳层与 iOS 风格

应用使用原生 `.la-pluma-app` 根节点。Navbar、页面区域、移动 tabbar 和 Sheet 等 chrome 与交互统一由 `Layout` 及 common 组件提供；`ios-theme.css` 负责 iOS 26 材质、应用 chrome、安全区和品牌适配，不要在页面中另起一套导航或 modal 基础样式。

- `ios-theme.css` 不是可选的「iOS 外壳」。它全局导入，`:root` 无条件覆盖；颜色、圆角、间距、控件高度都以它为准，不要按「只在 iOS 外壳下生效」理解。
- 桌面端（`lg` 及以上）显示左侧工作台导航；移动端使用悬浮的 iOS 风格底部胶囊导航，右侧「更多」按钮打开次要页面的 Sheet。两端必须复用 `Layout` 的 URL 路由和 active 状态，不要按 viewport 建立第二份导航状态。
- 桌面工作台使用 macOS 结构侧栏：一条跨越顶栏与导航区的连续圆角材质边界、可用的工作区搜索、分组导航和 24px 图标底座。品牌入口属于侧栏右侧的工作区顶栏，不能进入或遮挡侧栏圆角区。当前项使用整行系统强调色与白色文字；这些桌面样式不得扩散到移动底栏和「更多」Sheet。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 `.la-pluma-app`。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `client/index.html` 使用 `viewport-fit=cover`。`Layout` 通过统一 token 管理 navbar、移动 tabbar 和对应安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- `Button`、`Card`、`Loading`、`Switch` 等 common 组件使用原生语义元素，在浏览器、jsdom、SSR 和嵌入式场景中渲染一致。不要按运行环境维护第二套组件 DOM。
- 浏览器默认样式与第三方样式可能影响按钮宽度、卡片外边距和活动指示器尺寸；这类基础规则集中放在 `ios-theme.css`、`index.css` 或 common 组件中，调用处不要用局部覆盖扩散规则。

桌面和移动端都要检查 light/dark、loading、disabled、empty、error 以及长标题/长操作文案；安全区设备还应确认 chrome 与页面内容没有双重留白。

---

## 页面骨架

新增页面从下面这个骨架开始，不要凭记忆重新组合容器：

```tsx
<div className="app-page ios-workspace-page" data-page="example">
  <PageHeader
    title="页面标题"
    subtitle="一句话说明这个页面能做什么"
    mobileLayout="inline"
    actions={<Button>主操作</Button>}
  />

  <div className="app-stack-section">
    <Card smoothCorners className="!p-0">
      <CardHeader
        title="区块标题"
        actions={<Button variant="ghost" size="sm">刷新</Button>}
      />
      <CardContent>
        <div className="app-stack-card">...</div>
      </CardContent>
    </Card>
  </div>
</div>
```

规则：

- `app-page` 在 `.la-pluma-app` 内 `padding-top` 恒为 0，只负责底部 padding；顶部间距由 `.la-pluma-content` 统一提供，横向留白也由 `Layout` 负责。不要再套 `max-w-*`、`px-*` 或第二层同用途容器。
- `ios-workspace-page` 是移动端的工作区材质类：仅 ≤639px 生效，收窄左右边距、把标题放大到 2rem/700、让页面内所有显式开启连续圆角的 Card / SmoothPanel 去掉边框并统一移动端阴影（选择器没有直接子级限制）；顶部间距本来已由 `.la-pluma-content` 提供。除 Dashboard 外的工作区页面都应带上它。
- `ios-borderless-cards` 只去掉显式 continuous-corner 卡片/面板的边框、`surface-soft` 阴影、非状态 `app-info-card` 边框、日志/设备列表阴影和 `.app-native-control` 描边；普通 `.app-card` 和 `status-*` 信息卡仍保留边框。配置/设置类页面按 ConfigManager 使用它；工具、单卡、阅读型页面按 CustomTools 不使用。Config、养成、日志、统计四个页面是现有使用者。
- `app-stack-section` 放在页面内容的内层，用于区块之间的纵向间距。不要把它和 `app-page` 叠成同一个元素，除非该页只有一层内容（ConfigManager 是这种情况）。
- Dashboard 使用 `app-page dashboard-page`，不套 `ios-workspace-page`；它是独立的高密度工作台。
- `PageHeader` 的一级工作区标题使用 `mobileLayout="inline"`；长状态交给 `FloatingStatusIndicator` 在右侧截断。

---

## 设计规范

### 色彩

页面不要再按模块自定义一套主色。除非是明确的状态语义或游戏资源稀有度，新增 UI 优先使用全局语义类：

- `surface-panel`：主要卡片和大面板。
- `surface-soft`：弱背景、状态条、次级容器。
- `control-surface`：输入框、选择框、筛选项、未选中的分段控件。
- `brand-action` / `brand-text`：主要操作和品牌强调。**`brand-text` 使用 `--app-accent-strong`，可用于图标和短品牌文字；长正文仍使用语义文字色。**
- `status-neutral` / `status-success` / `status-warning` / `status-danger` / `status-info`：语义状态提示。中性状态用于待机、默认或与状态无关的提示浮层；它自带 1px 内描边，不受 `ios-borderless-cards` 影响，因此浮层在各类页面外观一致。
- `status-success-action` / `status-danger-action`：成功、危险类操作按钮。
- `form-error-surface` / `form-error-text`：表单错误态。

品牌色在已发布主题中是 iOS 系统蓝：浅色 `--app-accent` #007aff / `--app-accent-strong` #005ecb，深色 #0a84ff / #64b5ff；`index.css` 里的 teal 是基础/回退值。需要「品牌文字」时用 `--app-accent-strong`（按当前主题取值），需要「品牌填充」时用 `--app-accent-action`；不要把浅色 hex 硬编码到深色页面。

表面按下面的层级取用，不要自造半透明白/黑：

| 层级 | 用法 |
| --- | --- |
| `--app-bg` / `--app-bg-soft` | 页面画布与渐变中段 |
| `surface-panel` / `--app-surface-solid` | 卡片、面板、浮层主体 |
| `surface-soft` / `--app-surface-muted` | 次级容器、分组、状态条 |
| `control-surface` | 输入、选择、分段控件 |
| `--app-glass-bg` / `--app-chrome-bg` | navbar、侧栏、tabbar 等 chrome |
| 遮罩 | 使用现有 modal/backdrop，不要新增 `bg-black/60` 一类临时值 |

不要新增页面级 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的颜色主题。需要新语义时，先在 `ios-theme.css` 和 `index.css` 增加 token 或语义类。

彩色、半透明或渐变背景上的文字必须按渲染结果满足 WCAG AA（正文 4.5:1，大字号 3:1），并在浅色和深色两套主题下分别核对：

- 品牌色文字优先使用 `--app-accent-strong`；`--app-accent` 只用于填充和描边。
- 状态色优先选择对应的 `*-text` 或 `*-action` 变体；`status-info` 使用 `--app-info-text`，可承载正文。
- 不要用 `opacity` 降低文字对比度来制造层级（例如用 `opacity-70` 做次级标签），改用语义文字色 `--app-text-muted` / `--app-text-soft`。
- 渐变、图片和设备画面上的文字最容易失手，必须在真实渲染页面上取样测量；只测一套主题会漏掉另一套的失败。

当前已实测的配对（修复后）：

| 组合 | 实测 | 结论 |
| --- | --- | --- |
| `--app-accent-strong` / 白底 | 6.06:1 | 通过 |
| `--app-accent-strong` / 页面底 | 5.43:1 | 通过 |
| `--app-accent-strong` / `surface-soft` | 4.74:1 | 通过 |
| `text-tertiary` / `surface-soft`（页面底合成） | 4.67:1 | 通过 |
| 白字 / `status-success-action` | 5.39:1 | 通过 |
| 白字 / `status-danger-action` | 5.38:1 | 通过 |
| `status-info` / 10% tint（浅 / 深） | 6.82 / 6.89:1 | 通过 |

以上按当前 token 计算；改颜色后重新核对。达到 WCAG 大字号标准（≥24px，或 ≥18.66px 粗体）时可按 3:1 使用。

### 文字层级

页面优先复用下列层级，不要为普通文本继续增加任意字号或字重。表格同时给出 Tailwind 写法、真实 token / 类和实际尺寸；**以 token / 类为准，不要只抄尺寸**。

| 层级 | 推荐写法 | 实际尺寸 |
| --- | --- | --- |
| 页面标题 | `PageHeader` 的 `.app-page-title` | 桌面 30px/700；手机 22px；`ios-workspace-page` 手机 32px/700 |
| 常规卡片标题 | `CardHeader` 的 `.app-section-title` | 18px / 600 / 1.45 |
| 紧凑区块标题 | `--app-font-card-title`（16px）/ 600 | 16px / 600 |
| 列表标题、字段名 | `text-sm font-semibold` | 14px / 600 |
| 正文、表单标签 | `text-sm text-secondary`；表单标签用 `text-sm font-medium` | 14px；正文 400，表单标签 500 |
| 辅助说明、标签 | `text-xs text-tertiary` | 12px，使用 `--app-text-soft`；在 `surface-soft` 上注意对比度 |
| 元数据、序号、时间戳 | `--app-font-meta` / 11px | 11px；不承载正文和操作名 |
| KPI 主数值 | `.data-readout-value.is-primary` | 30px / 600 / `tabular-nums` |

- 页面主标题只使用 `PageHeader` 的 `.app-page-title`，不要在页面里重写字号和字重。
- 多行正文和说明使用 `leading-6` 或 `leading-relaxed`；单行标签和数值保持紧凑行高。标题和中文正文不要新增 letter spacing，英文全大写微标签才可使用更宽字距。
- `11px` 仅用于序号、时间戳和短元数据；`8px` 至 `10px` 不得承载中文正文、操作名或重要状态。
- 字重使用 `400`、`500`、`600`、`700`。
- 字体族继承 `--app-font-family`（SF Pro / system-ui）。等宽字体只用于日志、序号、命令和技术标识；`ui-rounded` 只用于计时或步进数值。不要给页面另设 `font-sans` 或中文黑体栈。
- 数据型界面必须使用 `font-variant-numeric: tabular-nums`（或现有 `.data-readout` 家族），数值与单位按 baseline 对齐；实时变化的数字不允许使用比例数字。

### 数据展示

统计数字统一使用现有 `.data-readout` 家族，不要在页面重写 KPI 字号：

- `.data-readout-value`：1.25rem / 600 / `tabular-nums`；`.is-primary` 为 1.875rem / 600。
- `.data-readout-number`：数值本身；`.data-readout-unit`：单位，使用 `--app-font-caption`；primary 数值的单位升到 `--app-font-section-title`。
- 数值与单位按 baseline 对齐；2/3 列继续用现有的 `data-count` 规则，不要自造 grid。
- 会变化的数字禁止使用比例数字；不要在 KPI 上再用 `text-3xl font-bold` 覆盖。

### 页面宽度

高密度工具页面使用统一的 `app-shell`：内容宽度、左右留白和安全区由 `Layout` 的 `.la-pluma-content` 决定。

- 桌面（≥1024px）：`.la-pluma-content` 为 `max-width: 112rem`，左 padding 1.25rem、右 padding 2rem；主内容列还要扣掉 17rem 侧栏，1920 视口下内容盒约 1596px。
- `--app-content-max`（100rem）和 `--app-page-gutter` 是 `.app-shell` 在基础/移动路径上的值，不是桌面最终宽度；改它们不会改变桌面页面宽度。
- 不要在页面级重复这些数值或嵌套 `max-w-*` 宽度容器；需要全局调整桌面宽度时改 `ios-theme.css` 的 `.la-pluma-content`。阅读型正文块可以在自己的内容区单独使用 `max-w-prose`（约 65ch）或 `max-w-[65ch]`，但不要用它限制整个页面容器。

### 圆角

圆角以 CSS 变量为准：

| token | 用途 |
| --- | --- |
| `--app-radius-xs` | 细小元素、默认边界 |
| `--app-radius-sm` | checkbox、小控件 |
| `--app-radius-md` | 紧凑控件与局部容器 |
| `--app-radius-lg` | 卡片、面板、分段控件、通用按钮和输入 |
| `--app-radius-pill` | 胶囊、头像、圆形状态点 |
| `--app-continuous-radius` | SmoothPanel / 一级连续圆角卡片（20px / 80%） |
| `--app-continuous-radius-compact` | 短小信息卡（16px / 80%） |

具体数值以 `ios-theme.css` 为准（已发布主题的圆角明显大于 `index.css` 的基础回退值）。不要把数值抄进页面代码，需要精确值时读 token。

Tailwind 的映射不是按类名直觉对应的，必须按下表使用：

| Tailwind | token |
| --- | --- |
| `rounded` / `rounded-sm` | `--app-radius-xs` |
| `rounded-md` | `--app-radius-sm` |
| `rounded-lg` | `--app-radius-md` |
| `rounded-xl` / `rounded-2xl` / `rounded-3xl` | `--app-radius-lg` |
| `rounded-full` | `--app-radius-pill` |

卡片、面板和一级容器优先使用 `SmoothPanel` 或 `Card smoothCorners`；它们的连续圆角由 `SmoothSurface` 计算，当前实现值固定为 20px / 80% 和 16px / 80%，不是 CSS token 驱动。需要改连续圆角时同时改组件常量和 `--app-continuous-radius`，否则外壳与内表面会不一致。

### 边框

普通可见边框统一使用 `1px`，颜色使用 `var(--app-border)`；需要更明确分隔时使用 `var(--app-border-strong)`。卡片、输入框、分段控件和普通信息容器不得按页面单独改成 `border-2` 或重色描边。

`2px` 只用于小尺寸控件的可辨识性或非容器结构，例如复选框外框和勾选符号、层级引导线、加载圈。焦点环、阴影和状态光环不是容器边框，不受此规则限制。新增例外前，应确认 1px 是否已经足够表达层级。

### 阴影

阴影只表达高度和层级，不承载品牌语义。按下面的层级取用，不要再发明第二套投影：

| 层级 | 用法 | 实现参考 |
| --- | --- | --- |
| 1. 卡片 / 面板 | 一级卡片、分组卡 | `surface-panel` / `app-card` 的现有阴影 |
| 2. 可点击卡片 | 仅整卡可点击时 | `surface-panel-hover`（命名例外，见下） |
| 3. 菜单 / popover | 下拉、菜单、分组浮层 | 复用组件自身阴影（主题菜单为 `0 2px 8px rgba(0,0,0,.10), 0 30px 80px rgba(0,0,0,.24)` + blur）；不要手写 |
| 4. tooltip | 轻量提示 | `0 5px 14px rgba(0,0,0,.16)` |
| 5. 弹窗 / Sheet | modal、sheet | 现有 Modal / Sheet 的阴影，不要自写 |
| 6. chrome | navbar、tabbar、侧栏 | `--app-glass-shadow` 或对应 chrome 类 |

- 统一使用中性投影；卡片、菜单和普通浮层保持向下、无水平偏移；底部 Sheet / tabbar 使用向上（负 Y）阴影。靠模糊半径和透明度区分层级。需要强调主操作时，用词重、填充色和尺寸，不要靠发光。
- 禁止用品牌色或状态色做模糊投影，也禁止零偏移的彩色光环（`0 0 0 3px` 配彩色）和彩色 `text-shadow`。
- 普通状态指示点的语义光环限制在扩散 ≤3px、透明度 ≤20%；`status-border-beam`（4px / 46%）和 `FloatingStatusIndicator` 的运行脉冲（4px / 70%，2s）是命名例外，按现有配方执行。
- 命名例外：`surface-panel-hover` 的 accent 20% 描边 + 9% 投影、`icon-well` 的 accent 12% 投影、`focus-visible` 焦点环属于现有交互态，允许保留；不要把它们复制到静态内容或普通容器。
- 悬停和按下状态沿用同一套中性投影，只调整透明度；只有命名例外可以改变描边/光晕颜色。
- `inset 0 0 0 1px` 的边缘高光、`inset 0 -1px 0` 的分隔线属于边缘而不是阴影，可以继续使用。
- 深色主题不要新增更重的黑色阴影；现有 `surface-panel` 的深色阴影保持不变，新的层级优先通过表面色阶、1px 边框和 `--app-glass-border` 表达。

### 层叠层级

页面代码不要自写 `z-index`；按现有层级取用：

| 层 | 值 | 用途 |
| --- | --- | --- |
| 内容 | 0 | 普通内容 |
| 桌面侧栏 frame、page-body | 1 | 桌面侧栏与页面主体 |
| 桌面 navbar | auto | 不要自建层 |
| PWA prompt | 50 | 安装提示 |
| 移动端 navbar | 60 | sticky 顶栏 |
| tabbar | 70 | 移动底栏 |
| modal | 80 | `Modal` |
| 运营页局部层 | 90 | 任务页工具层 |
| sheet backdrop / sheet | 1100 / 1110 | Sheet |
| tooltip | 1120 | `Tooltip` |
| drag ghost | 1200 | 拖拽浮层 |
| data menu | 2000 | 统计页菜单 |
| fullscreen device | 9999 | 设备全屏 |

新增浮层优先复用 `Modal`、`Tooltip`、Sheet；需要新层时先在组件层登记，不要在页面写 `z-[…]` 或复制 9999。表中的具体值是现有组件的层，不要把它们当成新的页面级常量。

### 间距

基础尺度遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 分别为 4、8、12、16、20、24px。语义间距的当前实际值（iOS 主题）：

| token | 桌面 | 手机 |
| --- | --- | --- |
| `--app-space-card` | 14px | 12px |
| `--app-space-panel` | 16px | 14px |
| `--app-space-section` | 18px | 16px |
| `--app-space-control-x` | 16px | 16px |
| `--app-space-page` | 20px | 18px |

≤639px 的 `ios-theme.css` 覆盖全部语义间距：card 12 / panel 14 / section 16 / page 18，control-x 保持 16；`ios-workspace-page` 的 `app-stack-section` gap 1rem 和 ≤640px 的 card header/content/info padding 0.875rem 与这套值一致。`index.css` 的移动端基础块已同步为同一组值，但实际生效仍以 `ios-theme.css` 为准。新增页面按 token 使用，不要全局覆盖 `.p-*`。

常用语义类：

- `app-page`：页面底部 padding；顶部间距由 `.la-pluma-content` 提供。
- `ios-workspace-page`：移动端工作区材质与标题，和 `app-page` 同层使用。
- `app-stack-card`：卡片内部或紧密内容的纵向间距。
- `app-stack-section`：页面区块之间的纵向间距。

Tailwind 映射：

| Tailwind | token |
| --- | --- |
| `gap-3` / `gap-4` / `space-y-4` | `--app-space-card` |
| `gap-5` / `gap-6` / `space-y-5` / `space-y-6` | `--app-space-section` |
| `space-y-3` | 未映射，仍是 12px |
| `p-*` / `px-*` / `py-*` / `m-*` | 未映射到语义间距，不要用它们做页面节奏 |

`gap-4` / `gap-6` 可以用在局部容器里；页面级区块节奏统一用 `app-stack-section`，不要再散写 `space-y-6`、`gap-6` 或 `p-6` 来代替它。

### 卡片与容器

通用组件优先级：

1. 能用 `Card`、`CardHeader`、`CardContent`、`SmoothPanel` 时优先使用组件。
2. 特殊布局不适合组件时，使用语义类：`app-card surface-panel`、`app-card surface-soft`、`app-info-card`。
3. 不要把页面区块都做成层层嵌套卡片；只有真正需要框住的内容才使用卡片。

- `Card` 自身带 `--app-space-panel` 内边距；同时使用 `CardHeader` / `CardContent` 时必须加 `!p-0`，否则会出现外层 + header + content 三层内边距。正确写法见「页面骨架」。
- `Card` 没有 `hover` 属性，也不透传 `onClick`、`role`、`tabIndex` 或 `aria-*`。整卡可点击时使用原生 `<button type="button" className="app-card surface-panel [surface-panel-hover] ...">`，并补上「交互状态与动效」里的 focus-visible 配方；或先扩展 `Card` 的 HTML 属性。只给 `className` 加 `surface-panel-hover` 不会让卡片可点击，也不会提供 cursor/focus。静态卡片不要加位移、闪动或临时阴影。
- 需要连续曲率但不是 `Card` 的面板时用 `SmoothPanel`；只有本身没有外阴影的圆角矩形才直接使用 `SmoothSurface`（从 `@/components/common/SmoothSurface` 直接导入，它不是 `@/components/common` 的公共导出）。

### 表单与按钮

新增表单优先使用 `Input`、`Select`、`Checkbox`、`Switch`。二元启停设置使用 `Switch`，多选或参数组合使用 `Checkbox`。多行文本和其他必须手写的原生控件使用：

- 输入控件：`app-input control-surface`
- 多行文本：`app-input control-surface !h-auto !min-h-28 resize-y px-3 py-2`（`app-input` 在手机上会被 `@media (pointer: coarse), (max-width: 768px)` 的 `height/min-height: 2.75rem !important` 覆盖；必须用 `!h-auto !min-h-28`，否则仍是单行）
- 复选项外层：`app-checkbox`
- 普通按钮：`app-button`
- 图标按钮：`app-icon-button`

iOS 风格三档 `Button` 高度由 `app-button-size-sm`、`app-button-size-md`、`app-button-size-lg` 统一管理，桌面分别为 36、44、48px；`Input` 和 `Select` 为 44px。手机断点和粗指针设备会把所有标准按钮、图标按钮与表单点击区提升到至少 44px。不要在调用处再叠加 `h-*`、`px-*`、`py-*` 缩小标准控件；图标专用工具条只有在桌面高密度场景才可明确使用更紧凑的尺寸，且不能承载文字。

`Switch` 的 `label` 只作为 `aria-label`，不会渲染可见文字；设置项必须在旁边另写可见标题和说明。`Card` 的标题由 `CardHeader` 渲染；不要再用 `h3` 手写一份同样的字号。

### 交互状态与动效

- 交互元素优先复用 `Button`、`IconButton`、`control-surface` 和 `surface-panel-hover`。不要为同类控件新增亮色渐变、强光晕或重投影。
- 主、成功、危险操作的 hover 只做主题色压暗；次级与幽灵操作只使用弱主题背景或轻描边。普通静态卡片保持稳定；只有卡片本身可点击时才使用 `surface-panel-hover`。
- 焦点样式统一为三套，手写控件复制其一，不要新写 `ring-2`：
  - `Button` / `IconButton`：`outline: 2px solid color-mix(in srgb, var(--app-accent) 62%, transparent); outline-offset: 2px`。
  - `Input` / `Select`：复用组件；实际为 `border-color: var(--app-accent); box-shadow: 0 0 0 3px var(--app-accent-soft)`；borderless 页面是背景变化 + `0 0 0 3px` accent 16%。手写输入优先套 `app-native-control`，不要自己写 `ring`。
  - 手写 `button` / 可点击卡片：复制 `Button` 的 outline 配方，不要只加 hover。
- `ios-borderless-cards`、`[data-automation-tasks]`、`[data-workbench-tasks]` 内的 `.app-native-control` 使用填充式聚焦：`border: 0; background: color-mix(in srgb, var(--app-accent-soft) 22%, var(--app-surface-muted)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent)`；这是现有例外，不要覆盖。
- disabled 状态需关闭点击与 hover，并使用 `opacity-50`、`cursor-not-allowed`；loading 期间按钮自动禁用，仅显示加载内容。
- 动效按下面的配方取用，不要所有场景都用 160ms：

| 场景 | 时长 / 参数 |
| --- | --- |
| 颜色、背景、阴影、普通变形 | 160–180ms |
| Switch 轨道 / 滑块 | 220ms ease / 240ms `cubic-bezier(0.22,1,0.36,1)` |
| 菜单、下拉 | 复用现有组件：主题菜单 spring `440/38/0.7`；自动化任务选择器 320ms `cubic-bezier(0.32,0.72,0,1)` |
| 弹窗 | spring `stiffness: 380, damping: 34, mass: 0.82` |
| 分段高亮 | spring `stiffness: 420, damping: 38, mass: 0.72` |
| Sheet | 现有 Sheet 的 `[0.32,0.72,0,1]` |

- 新增 CSS 或 Framer Motion 动效必须尊重 reduced motion；使用 `useReducedMotion` 或 `@media (prefers-reduced-motion: reduce)`，关闭位移、旋转和弹簧，只保留必要的透明度变化。
- `status-border-beam` 仅用于启动、连接或执行中的局部状态反馈，并通过 `is-active` 控制；完成、空闲和静态卡片不得常驻光效，也不要叠加第二条可见边框。

### 反馈状态

按下面顺序选择反馈方式，不要用空状态伪装错误，也不要为同一结果重复显示多种提示：

| 情况 | 使用方式 |
| --- | --- |
| 字段校验失败 | `Input`、`Select` 的 `error` prop；`hint` 只在没有错误时显示 |
| 控制台首次且没有本地缓存 | 控制台内部的 `DashboardSkeleton`；恢复或返回页面时先显示最后一次成功快照并后台刷新，不要重播整页骨架 |
| 懒加载路由 | `PageSkeleton variant={routeId}`（从 `@/components/common` 导出）；支持 dashboard / automation / combat / roguelike / training / logs / statistics / config，其他 id 只有页头骨架，复杂页面用 `Loading` |
| 局部内容正在读取 | `Loading` |
| 列表、流程或卡片无数据 | `EmptyState`，按容器选择 `compact` |
| 区域读取失败 | 在原区域显示可恢复的错误与重试操作；不要改成空状态 |
| 全局结果与错误 | `useStatusStore.setMessage`，由 `FloatingStatusIndicator` 展示；错误不自动收起（当前没有关闭按钮），由下一次操作或页面生命周期清除，其他短消息由 store 自动收起，不要自行写清除定时器 |
| 删除、清空等不可逆操作 | `ConfirmDialog`；新代码不得使用 `window.confirm` |

日志控制台、养成筛选空结果等固定高度或高密度区域可保留专用状态样式。局部表单成功提示、日志提示等需要紧邻操作区或可手动关闭时，也可保留在面板内。项目没有通用 Toast 组件，`FloatingStatusIndicator` 是全局任务状态和短消息载体，不应被当作普通 toast 复刻。

`ConfirmDialog.onConfirm` 可以返回 Promise。返回 `false` 或抛出错误时弹窗保持打开；错误会在弹窗内展示，调用方不要提前关闭弹窗或吞掉失败结果。

### 图标

- 普通功能图标优先使用已引入的 `lucide-react`；业务身份和概览图标优先复用 `Icons.tsx`。一级工作区标题与控制台一致，不添加装饰图标；不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。线宽使用 1.8–2.0；11–14px 的小箭头可用 2.1–2.4 补偿。不要用 lucide 默认的 2.0 画 16px 行内图标而不检查视觉重量。
- `icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标；它是阴影规则的命名例外。
- 无文字操作使用 `IconButton`，调用时必须提供 `aria-label`，并提供 `title` 或 `tooltip` 作为提示；只传 `tooltip` 时不能省略 `aria-label`。有文字的操作使用 `Button icon`，不要在调用处额外覆盖图标与文字间距或按钮尺寸。
- `IconButton` 的 `sm`、`md`、`lg` 与相同档位的 `Button` 共用尺寸，并在手机和粗指针设备保持至少 44px。不要页面自行缩小点击面积；桌面高密度工具条使用 `IconButton size="sm"`（36px），不要写 32px 一类不存在的档位。
- 装饰图标加 `aria-hidden="true"`；状态和结果必须同时提供可读文字或 `aria-label`，不能只依赖颜色和图标。

按钮颜色按语义选择 `brand-action`、`status-success-action`、`status-danger-action`，不要按页面重新定义按钮渐变。

### 响应式与滚动

- 移动端间距通过 token 管理；≤639px 的实际值为 card 12 / panel 14 / section 16 / page 18，见「间距」。不要全局覆盖 `.p-4`、`.p-6`、`.gap-6`。
- 页面滚动条当前全局隐藏，避免切换页面或列表时因系统滚动条出现导致布局左右跳动。桌面端如果需要滚动位置线索，使用现有滚动容器的渐隐或自定义指示器，不要直接恢复系统滚动条。
- 文本和控件要在移动端自然换行，不允许为了保留桌面布局而裁剪有效内容。`PageHeader` 的副标题在 <640px 当前会被隐藏，这是既有例外；新页面若副标题承载必要信息，改用可见的一行副标题或页内说明，不要依赖它。
- 新页面按 mobile-first 编写：`sm` (640px) 用于显示次级信息或恢复横向工具栏，`md` (768px) 用于中等宽度布局，`lg` (1024px) 与 `xl` (1280px) 才扩展为双栏或多栏。不要新增 `899px`、`1023px` 这类页面级断点；自动化三栏等既有组件可保留自身的专用断点。
- 窄屏下主内容默认单列，顶部操作可纵向排列或全宽；双栏/三栏要在内容不足时按列折叠，不能以固定宽度挤压正文。

### 布局密度

- 常规内容宽度由 `Layout` 的 `.la-pluma-content` 决定（桌面 112rem，扣 17rem 侧栏），页面内部避免再套一层同用途的宽度和 padding 容器。
- 区块间使用 `app-stack-section`，卡片内使用 `app-stack-card`。只有内容可独立扫描、操作或滚动时才使用卡片；内部分区优先用 `CardHeader`、`CardContent`、分隔线、网格或 `surface-soft`。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`，主内容必须保持弹性。每一列都应有 `minmax(0, ...)` 或 `min-w-0`，避免长文本造成横向溢出。
- 页面标题当前是 30px/700，KPI 也是 30px；同屏出现时，KPI 使用 `.data-readout-value.is-primary` 的 600 字重，标题保持 700，不要再用 `text-3xl font-bold` 给 KPI 加粗。
- 不要为了填满右侧留白而硬塞第二张卡，也不要把普通页面区块做成卡片嵌套卡片。独立工作区、弹窗、空状态和设备预览属于合理例外。
- 自动化编排器、肉鸽工作区是高密度专用布局：前者按三栏/两栏/单栏专用断点折叠，后者在窄屏转单栏。它们不是新页面的默认模板。

---

## 组件列表

### 组件选型

组件细节（props、导入方式、示例）统一维护在 `client/src/components/common/README.md`，本节只说明什么时候用哪个。

| 场景 | 组件 |
| --- | --- |
| 页面标题与操作区 | `PageHeader`（一级工作区用 `mobileLayout="inline"`） |
| 卡片与分区 | `Card` / `CardHeader` / `CardContent`；需要连续曲率时用 `SmoothPanel` |
| 操作 | `Button`（有文字）、`IconButton`（仅图标，必须带 `aria-label`，并提供 `title` 或 `tooltip`） |
| 图标控件提示 | `Tooltip`；触发元素仍需自带 `aria-label`，不要和原生 `title` 同时使用 |
| 表单 | `Input`、`Select`、`Checkbox`、`Switch`；多行文本用带 `app-input control-surface min-h-28 resize-y px-3 py-2` 的原生 `textarea` |
| 空状态 | `EmptyState`，只用于确实没有数据 |
| 不可逆操作确认 | `ConfirmDialog` |
| 局部加载 | `Loading`；懒加载路由用 `PageSkeleton`；控制台骨架用 `DashboardSkeleton`（从 `@/components/common/Loading` 直接导入，非公共导出） |
| 任务状态环 | `StatusMark`（从 `@/components/common` 导出） |
| 动态分段标签 | `useFluidTabIndicator` |

### useFluidTabIndicator

**文件位置**：`client/src/hooks/useFluidTabIndicator.ts`

**适用场景**：带有 Framer Motion 高亮底层的分段标签。它会在切换、容器尺寸变化、标签内容变化和窗口缩放时，把高亮层对齐到当前按钮。不要在每个页面重复维护 `ResizeObserver`、元素 ref 和坐标计算。

```tsx
const { containerRef, activeRect, setTabRef } = useFluidTabIndicator(activeTab)

<div ref={containerRef} className="relative">
  <motion.div
    className="pointer-events-none absolute rounded-[var(--app-radius-md)] bg-[var(--app-accent-soft)]"
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

标签 ID 需是字符串联合类型，且高亮容器需要 `relative` 定位。作业、养成、肉鸽等页面已使用该 Hook；高亮层必须带自己的背景/圆角，否则复制的示例不可见。

---

## 重构建议

新增页面或改老页面时按这个顺序：

1. 页面外层 `app-page`（非 Dashboard 再加 `ios-workspace-page`，需要无边框分组卡时加 `ios-borderless-cards`），标题使用 `PageHeader` + `mobileLayout="inline"`。
2. 大面板使用 `Card` 或 `SmoothPanel`；使用 `CardHeader` / `CardContent` 时给 `Card` 加 `!p-0`，内部分区用分隔线、网格或透明分组。
3. 表单、按钮、空状态、加载按「组件选型」表选择，不要手写等价实现；多行文本、`Switch` 的可见标签按「表单与按钮」处理。
4. 新的颜色、圆角、间距需求先抽成 token 或语义类，再落到页面；颜色同时改 `index.css` 和 `ios-theme.css`。
5. 按下面「新增页面验收清单」自检，再交付。

### 新增页面验收清单

- [ ] 页面骨架包含 `app-page`、必要的 `ios-workspace-page` / `ios-borderless-cards`、内层 `app-stack-section`。
- [ ] `PageHeader` 使用 `mobileLayout="inline"`；没有重复的宽度容器或水平 padding。
- [ ] 使用 `CardHeader` / `CardContent` 的卡带了 `!p-0`；静态卡片没有 hover 位移。
- [ ] loading / empty / error / disabled / 长标题 / 长操作文案都有检查。
- [ ] 375 / 768 / 1280 三个宽度、浅色和深色主题都看过；没有横向溢出。
- [ ] 所有交互控件有 `focus-visible`、disabled、loading 行为；触控目标 ≥44px。
- [ ] 没有新增页面级颜色、彩色阴影、彩色光环、未登记的 z-index。
- [ ] 会变化的数字使用 `tabular-nums`；正文对比度按「色彩」表核对。

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

- [ ] 持续把零散手写卡片迁移到 `Card` 或 `app-card`；这是长期 backlog，不属于单次功能改动。
- [ ] 为核心通用组件补充单元测试或视觉回归检查。
- [ ] 每次改颜色或字号，在浅色和深色两套主题的真实渲染页面上各核对一次对比度。
- [ ] token 或组件修复后，更新「当前实现备注」，不要让它长期存在。

---

## 当前实现备注

下面这些是当前实现与规范的已知差异/备注。新增代码按规范写。

- **连续圆角**：`SmoothPanel` / `SmoothSurface` 的 20/16 是 TS 常量，不是 token；组件源码已注明与 `--app-continuous-radius` / `-compact` 同步，改 token 时要同步改常量。
- **`FloatingStatusIndicator`** 当前没有关闭按钮；错误不会自动收起，只能被下一次消息或页面生命周期清除。需要“用户关闭”时先补组件的清除入口。
- **手写控件 `ring-2`**：现有约 10+ 处仍使用 `focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]`；目标是迁移到 Button 的 outline 配方，新代码不要新增。

---

**创建时间**：2026-02-09
**最后更新**：2026-11-04
**维护者**：@mps233
