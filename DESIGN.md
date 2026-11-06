# 通用组件库与设计规范

## 设计原则

这份规范首先服务三件事：让页面有层级、让状态可读、让模型能稳定复现。遇到规则没有覆盖的情况，按下面顺序判断：

1. **材质先于装饰。** 层级先由表面、边缘、留白和字体建立；颜色和光效只做最后一步强调。
2. **内容先于 chrome。** 品牌和情绪进入内容层（页面 hero、空状态、区块背景、数据可视化）；导航、工具栏、控件保持克制和系统化。
3. **一屏一个主角。** 每个视口只有一个 Display 元素、一个主操作和一个 L2 级动态状态；其他元素主动退后。
4. **注意力是预算。** 动效、光效、状态色按 ambient / live / attention / interruptive 分层，不允许靠叠加制造“高级感”。
5. **可访问性是底线。** 对比度、键盘、读屏、触控目标、reduced motion、reduced transparency 不是可选项。
6. **平台一致，但保留 La Pluma 的个性。** 遵循 iOS / macOS 27 的材质与布局语言，同时用小面积、可识别的品牌记号建立身份；桌面浮动侧栏是明确的品牌例外。

---

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
| 阴影 | 通用卡片/菜单/弹层没有 elevation token；chrome 有专用 token | 按「表面与高度」表使用现有类 |

### token 分层（目标架构）

当前代码仍以 semantic token + 字面值混合为主。标注为「目标」的 token / 模式是迁移方向，当前未落地；不要在新页面直接引用不存在的 token。新增或重构 token 时按下表收口，避免页面直接写 hex / px：

| 层 | 例子 | 规则 |
| --- | --- | --- |
| primitive | `--la-color-blue-600`、`--la-space-4` | 只有这一层写 hex 和 px |
| semantic | `--app-accent-strong`、`--app-surface-*`、`--app-text-*`、状态色 | 只引用 primitive 或 `color-mix` |
| component | `--app-button-primary-bg`、`--app-card-radius` | 只引用 semantic |

页面只使用 semantic / component token；新增颜色时先判断现有语义角色是否够用，再新增 semantic token，最后才考虑 component token。

### 主题与偏好变体

| 变体 | 触发 | 要求 |
| --- | --- | --- |
| light / dark / system | `useUIStore` | 全部 token 双主题核对 |
| increased contrast | `prefers-contrast: more` | 边框、文字、状态色加强；不依赖透明度 |
| reduced transparency | `prefers-reduced-transparency: reduce` | 玻璃退化为实色表面，保留 1px 边缘 |
| coarse pointer | `pointer: coarse` | 所有点击区 ≥44px |
| standalone PWA | `display-mode: standalone` | 安全区、底部 tabbar 留白 |
| safe area | `env(safe-area-inset-*)` | chrome 自己处理，内容区不重复叠加 |

---

## 材质

iOS / macOS 27 的 Liquid Glass 是 iOS 26 材质的精修，不是换一套语言：更好的背景扩散和可读性、深色边缘 + 更亮的高光、可从 ultra clear 调到 fully tinted 的用户透明度。Web 无法读取系统滑块，但必须支持两个等价的无障碍开关：`prefers-reduced-transparency` 和 `prefers-contrast`。

材质只用在这三类层：

| 材质 | 用法 | 目标 token | 回退 |
| --- | --- | --- | --- |
| regular | 默认 chrome、导航、工具条 | `--app-glass-bg` + `--app-glass-border` | 实色 `--app-surface-solid` |
| clear | 大图、hero、低密度浮层 | 更低透明度的 glass | 同 regular |
| tinted | 日志、表单、高密度面板 | glass + 更高的 surface 混合 | 同 regular |

规则：

- 玻璃只用于“悬浮在内容之上”的层；禁止玻璃叠玻璃，禁止在普通卡片内部再套玻璃。
- 边缘用 1px darkened edge + inset specular highlight 表达材质；禁止用彩色 glow 模拟玻璃。
- 任何透明度下正文都必须可读；文字对比度不能依赖 blur。玻璃层上的文字按实际合成背景测 WCAG AA。
- `prefers-reduced-transparency: reduce` 时改为实色表面；`prefers-contrast: more` 时加强边框和文字，不保留半透明装饰。
- 新的材质 token 和 `regular / clear / tinted` 语义尚未在代码中落地；当前 `ios-theme.css` 的 glass token 是固定值，按「当前实现备注」逐步替换。

---

## 原生响应式壳层与平台语言

应用使用原生 `.la-pluma-app` 根节点。Navbar、页面区域、移动 tabbar 和 Sheet 等 chrome 与交互统一由 `Layout` 及 common 组件提供；`ios-theme.css` 负责 Liquid Glass 材质、应用 chrome、安全区和品牌适配，不要在页面中另起一套导航或 modal 基础样式。

- `ios-theme.css` 不是可选的「iOS 外壳」。它全局导入，`:root` 无条件覆盖；颜色、圆角、间距、控件高度都以它为准。
- 平台一致，但保留 La Pluma 的个性：系统负责 chrome 的结构和材质，品牌进入内容层（见「品牌识别」），不要把系统蓝当成品牌本身。
- 工具栏、tabbar、侧栏的背景由材质层绘制；页面不要给这些 chrome 画不透明底色、自定义渐变或第二层 glass。
- 主题由 `useUIStore` 的 `light`、`dark`、`system` 管理，并同步到文档根节点和 `.la-pluma-app`。组件或页面不要直接操作 `.dark`，也不要创建局部主题开关。
- `client/index.html` 使用 `viewport-fit=cover`。`Layout` 通过统一 token 管理 navbar、移动 tabbar 和对应安全区高度；自定义 fixed/sticky 层只有在不属于这些 chrome 时才使用 `env(safe-area-inset-*)`，内容区不要重复叠加顶部或底部 inset。
- `Button`、`Card`、`Loading`、`Switch` 等 common 组件使用原生语义元素，在浏览器、jsdom、SSR 和嵌入式场景中渲染一致。不要按运行环境维护第二套组件 DOM。
- 浏览器默认样式与第三方样式可能影响按钮宽度、卡片外边距和活动指示器尺寸；这类基础规则集中放在 `ios-theme.css`、`index.css` 或 common 组件中，调用处不要用局部覆盖扩散规则。

### 桌面壳层：浮动侧栏是 La Pluma 的选择

macOS 27（Golden Gate）的方向是 edge-to-edge 侧栏、滚动折射和更统一的 toolbar；La Pluma **不采用** 这套桌面壳层方向。浮动圆角侧栏是产品的有意选择，不是待修的差距。

- 保留 0.75rem 内缩的浮动圆角 frame、连续圆角材质边界和现有 toolbar 结构；不要为了对齐 macOS 27 把侧栏贴边、改折射或重做 toolbar。
- 侧栏选中态保留现有的 accent 填充 + 白字/白图标；不要改成 subtle fill + 彩色图标，也不要新增左侧指示条。
- macOS 27 的 uniform toolbar、窗口圆角收敛只作为未来可选探索，不是当前规范要求；改壳层前先出视觉对比并确认。
- 移动端保留悬浮胶囊 tabbar 和「更多」Sheet，不要按桌面侧栏规则改移动端。

---

## 品牌识别

系统 accent 是交互色，不是品牌色。品牌由三部分组成：**记号、氛围、语气**。

| 触点 | 允许元素 | 强度 | 禁止 |
| --- | --- | --- | --- |
| 侧栏品牌位、favicon、PWA 图标 | 羽毛 / 墨迹 / wordmark | 1 | 进入导航项或数据卡 |
| 页面 hero、空状态、首次加载 | 一个羽毛/墨迹母题 | 2 | 每页多处重复 |
| 页面画布 | 低对比 ink wash / ambient | 2 | 每页最多一次 |
| 数据可视化 | 品牌 accent 只做强调 | 1 | 彩虹类别色 |
| 按钮、导航、状态 | 系统 accent / 状态色 | — | 用品牌色替代状态语义 |

- 内容层可以有一个低对比的 `--app-ink-wash` 纸墨渐变（目标 token），只画在页面画布上，不进入卡片内部；不要用渐变换取“高级感”。
- 游戏语义独立于状态色：稀有度 `--game-rarity-1…6`（目标 token）六档低饱和色，只用于星级、头像外框、材料图标边缘或 ≤2px 标记；材料、关卡、职业、分队用中性底 + 字形/图标区分，不扩成彩虹。
- 单卡内游戏语义色面积 ≤10%；chrome、正文、按钮、卡片底色不得使用游戏语义色。
- 品牌和游戏语义都要有 light / dark / increased-contrast 三套颜色值；材质另按 regular / clear / tinted 和 reduced-transparency 回退处理，并纳入对比度验收。
- 当前实现只有系统蓝和一句“游戏资源稀有度”例外；品牌内容层和 `--game-rarity-*` 尚未落地，按「当前实现备注」推进。

---

## 页面原型

先声明页面原型，再写页面。不要把设置页、日志页、设备页都塞进同一套 Card 骨架。

| 原型 | 首屏主角 | 默认布局 | 容器 / 表面 | 禁止 |
| --- | --- | --- | --- | --- |
| 运行台（Dashboard） | 当前运行状态 / 快捷开始 | 高密度卡片流 + 状态带 | canvas + raised card + live 状态 | 整页包一张大 Card |
| 数据工作区（统计） | 一个主指标 / 趋势 | 摘要 readout + 筛选 + 网格或表格 | raised card + well（图表） | 无判据地堆 KPI |
| 流式控制台（日志） | 日志流 | 工具栏 + 全高 well + 历史 | well + chrome | 把日志塞进普通 Card |
| 编排画布（自动化） | 流程 / 当前节点 | 三栏 / 两栏 / 单栏专用布局 | flat group + 局部 raised | 复制成新页面模板 |
| 设备视口（Scrcpy / 监控） | 设备画面 | 黑色 viewport + 外部控制条 | viewport + chrome | 给画面加卡片阴影 |
| 设置 / 表单 | 当前分组 + 保存结果 | 单列 section + 保存条 | raised card + control-surface | 多层卡片嵌套 |

参考实现：

| 原型 | 参考文件 | 可复用 | 不要照抄 |
| --- | --- | --- | --- |
| 运行台 | `Dashboard.tsx` | 状态带、卡片流、快捷操作 | 具体业务数据 |
| 数据工作区 | `DataStatistics.tsx` | 摘要 readout、筛选、卡片网格 | 固定统计字段 |
| 流式控制台 | `LogViewer.tsx` | 工具栏、控制台、历史列表 | 日志解析逻辑 |
| 设置 / 表单 | `ConfigManager.tsx` | section 导航、保存条、`!p-0` 卡片 | 具体配置项 |
| 单卡工具 | `CustomTools.tsx` | 单卡选择、即时执行 | 工具清单 |
| 编排 / 设备 | `AutomationTasks.tsx` / `ScrcpyDeviceView.tsx` | 专用高密度布局 | 不要当默认模板 |

---

## 页面骨架

设置、数据工作区和单卡工具从下面的默认骨架开始：

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
- `ios-workspace-page` 是移动端的工作区材质类：仅 ≤639px 生效，收窄左右边距、把标题放大到 2rem/700、让页面内所有显式开启连续圆角的 Card / SmoothPanel 去掉边框并统一移动端阴影。除 Dashboard 外的工作区页面都应带上它。
- `ios-borderless-cards` 只去掉显式 continuous-corner 卡片/面板的边框、`surface-soft` 阴影、非状态 `app-info-card` 边框、日志/设备列表阴影和 `.app-native-control` 描边；普通 `.app-card` 和 `status-*` 信息卡仍保留边框。配置/设置类页面按 ConfigManager 使用它；工具、单卡、阅读型页面按 CustomTools 不使用。
- `app-stack-section` 放在页面内容的内层，用于区块之间的纵向间距。不要把它和 `app-page` 叠成同一个元素，除非该页只有一层内容（ConfigManager 是这种情况）。
- Dashboard 使用 `app-page dashboard-page`，不套 `ios-workspace-page`；它是独立的高密度工作台。
- `PageHeader` 的一级工作区标题使用 `mobileLayout="inline"`；长状态交给 `FloatingStatusIndicator` 在右侧截断。
- 其他原型按「页面原型」表的结构写，不要用这套骨架硬套日志、设备视口或三栏编排。

---

## 设计规范

### 色彩

页面不要再按模块自定义一套主色。除非是明确的状态语义或游戏资源稀有度，新增 UI 优先使用全局语义类：

- `surface-panel`：主要卡片和大面板。
- `surface-soft`：弱背景、状态条、次级容器。
- `control-surface`：输入框、选择框、筛选项、未选中的分段控件。
- `brand-action` / `brand-text`：主要操作和品牌强调。`brand-text` 使用 `--app-accent-strong`，可用于图标和短品牌文字；长正文仍使用语义文字色。
- `status-neutral` / `status-success` / `status-warning` / `status-danger` / `status-info`：语义状态提示。中性状态用于待机、默认或与状态无关的提示浮层；它自带 1px 内描边，不受 `ios-borderless-cards` 影响。
- `status-success-action` / `status-danger-action`：成功、危险类操作按钮。
- `form-error-surface` / `form-error-text`：表单错误态。

当前主题的 accent 是 iOS 系统蓝：浅色 `--app-accent` #007aff / `--app-accent-strong` #005ecb，深色 #0a84ff / #64b5ff；它承担交互色和品牌强调的文字/填充（`brand-text` / `brand-action`），但品牌本身由「品牌识别」的记号、氛围和语气承担。`index.css` 里的 teal 是基础/回退值。需要品牌文字时用 `--app-accent-strong`，需要品牌填充时用 `--app-accent-action`；不要把浅色 hex 硬编码到深色页面。

不要新增页面级 `from-violet-*`、`text-orange-*`、`bg-cyan-*` 这类随手写的颜色主题。需要新语义时，先在 `ios-theme.css` 和 `index.css` 增加 token 或语义类。

彩色、半透明或渐变背景上的文字必须按渲染结果满足 WCAG AA（正文 4.5:1，大字号 3:1），并在浅色和深色两套主题下分别核对：

- 品牌色文字优先使用 `--app-accent-strong`；`--app-accent` 只用于填充和描边。
- 状态色优先选择对应的 `*-text` 或 `*-action` 变体；`status-info` 使用 `--app-info-text`，可承载正文。
- 不要用 `opacity` 降低文字对比度来制造层级，改用语义文字色 `--app-text-muted` / `--app-text-soft`。
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

非文本对比度：焦点环、控件边界、选中指示、图表系列、meter 填充对相邻色至少 3:1；禁用态豁免。不要只靠颜色区分状态，必须同时有文字、图标或位置。

### 表面与高度

表面按下面的层级取用，每个视觉区域最多一个 raised surface：

| 层级 | 用途 | 表面 / 边缘 | 阴影 |
| --- | --- | --- | --- |
| 0 画布 | 页面底 | `--app-bg` / `--app-bg-soft` | 无 |
| 1 flat group | 无框分组 | 留白 + 1px 分隔线 | 无 |
| 2 raised card | 独立可扫描/可操作内容 | `surface-panel` / `app-card` | 现有卡片阴影 |
| 3 well | 日志、终端、代码块、温度图 | `surface-muted` + inset 1px，无外阴影 | 无 |
| 4 viewport | 设备预览、监控画面 | 黑底 + 内描边 | 无 |
| 5 chrome overlay | navbar、tabbar、侧栏、浮层 | glass / tinted | chrome token |

- 只有内容可独立扫描、操作或滚动时才使用 raised card；普通页面区块用 flat group、分隔线、网格或 `surface-soft`。
- well 不再叠加 1px 外部边框 + 外阴影；用内凹面表达“可滚动/可输入”。
- 玻璃只用在第 5 层；禁止玻璃叠玻璃，禁止给普通卡片加 blur 冒充材质。
- `prefers-reduced-transparency: reduce` 时所有 glass/半透明层退化为 `--app-surface-solid` 并保留 1px 边缘。

### 文字层级

页面优先复用下列层级，不要为普通文本继续增加任意字号或字重。**以 token / 类为准，不要只抄尺寸。**

| 角色 | 唯一写法 | 桌面 / 手机 | 字重 / 行高 | 使用场景 |
| --- | --- | --- | --- | --- |
| Display（目标） | 仅现有 Dashboard hero / 运行台主状态；新页面不要新增 | 32–40px / 26–32px | 700 / 1.05 | 每屏最多一个 |
| 页面标题 | `PageHeader` 的 `.app-page-title` | 30px / 22px（workspace 手机 32px） | 700 / 1.15 | 页面主标题 |
| Section | `CardHeader` 的 `.app-section-title` | 18px | 600 / 1.45 | 卡片、主要区块 |
| Card / 紧凑区块 | `--app-font-card-title` | 16px | 600 | 次级区块 |
| 列表标题、字段名 | `text-sm font-semibold` | 14px | 600 | 列表项、配置字段 |
| 正文 | `text-sm text-secondary` | 14px | 400 / 1.6 | 描述、说明 |
| 表单标签 | `text-sm font-medium text-secondary` | 14px | 500 | 输入标签 |
| 辅助说明 | `text-xs text-tertiary` | 12px，`--app-text-soft` | 400 | 元数据、提示 |
| 元数据、序号、时间戳 | `--app-font-meta` | 11px | 500 | 不承载正文 |
| KPI 主数值 | `.data-readout-value.is-primary` | 30px | 600 / `tabular-nums` | 统计主指标 |
| 代码 / 技术标识 | `font-mono` + 等宽字体族 | 12–13px | 500 | 日志、URI、命令 |

- 页面主标题只使用 `PageHeader` 的 `.app-page-title`，不要在页面里重写字号和字重。
- 标题使用 `text-wrap: balance`，正文使用 `text-wrap: pretty`；中文正文行宽 32–40em，英文 60–75ch。页面标题的尺寸由 `.app-page-title` 的响应式 token 控制，页面里不要写 clamp 或第二套字号；控件和正文保持固定值。
- 中文标题统一用 `CjkText` 包裹标题文字：它用 BudouX 在词间插入 `<wbr>`，再由 `.app-cjk-breaks` 应用 `word-break: keep-all` 与 `overflow-wrap: anywhere`。不要手写 `<wbr>`，不要对正文使用 `keep-all`，也不要用 `Intl.Segmenter` 代替 BudouX。
- 中文界面由全局 `:lang(zh)` 规则获得 `text-autospace: normal` 与 `text-spacing-trim: trim-start`；代码、输入框和等宽技术文本自动退出 autospace。长文正文使用 `.app-prose-zh`（`text-align: justify`，32 个汉字的行宽）；带两字缩进的长文再加 `.is-indented`（改用 `space-first`）。
- 数字与单位之间需要不可断行时使用 `keepNumberWithUnit`（U+00A0），不要手写普通空格再依赖 `nowrap`。会变化的数值保持 `tabular-nums`；共享 `.data-readout`、表格、`time` 和仪表数值已由全局规则覆盖。
- 单行截断统一使用 `TruncatedText`：只有 `scrollWidth > clientWidth` 时才显示完整文本的 Tooltip；flex 行内的文本传 `triggerClassName="flex-1 min-w-0"`。不要再用无条件 `title` 或裸 `truncate`。
- 禁止使用 `line-break: anywhere`；需要兜底断行时用 `overflow-wrap: anywhere`。`word-break: break-all` 只允许用于没有中文标点的技术 URI，不能用于正文或标题。
- 多行正文使用 `leading-6` 或 `leading-relaxed`；单行标签和数值保持紧凑行高。中文正文不要新增 letter spacing，英文全大写微标签可用 0.06em。
- `11px` 仅用于序号、时间戳和短元数据；`8px` 至 `10px` 不得承载中文正文、操作名或重要状态。
- 字重使用 `400`、`500`、`600`、`700`。
- 字体族继承 `--app-font-family`（SF Pro / system-ui）。等宽字体只用于日志、序号、命令和技术标识；`ui-rounded` 只用于计时或步进数值。不要给页面另设 `font-sans` 或中文黑体栈。
- 数据型界面必须使用 `font-variant-numeric: tabular-nums`，数值与单位按 baseline 对齐；实时变化的数字不允许使用比例数字。

数字与单位格式：

| 类型 | 格式 | 例子 |
| --- | --- | --- |
| 整数 | 千分位 | `1,234` |
| 百分比 | 保留必要小数 | `+12.5%` |
| 区间 | en dash，不加空格 | `3–5` |
| 时长 | 小时 + 分 | `3 小时 20 分` |
| 文件大小 | 一位小数 + 空格 + 单位 | `2.4 GB` |
| 日期时间 | ISO 日期 + 24 小时 | `2026-11-05 14:32` |
| 缺失值 | 统一 em dash | `—` |

### 数据展示

统计数字统一使用现有 `.data-readout` 家族，不要在页面重写 KPI 字号：

- `.data-readout-value`：1.25rem / 600 / `tabular-nums`；`.is-primary` 为 1.875rem / 600。
- `.data-readout-number`：数值本身；`.data-readout-unit`：单位，使用 `--app-font-caption`；primary 数值的单位升到 `--app-font-section-title`。
- 数值与单位按 baseline 对齐；2/3 列继续用现有的 `data-count` 规则，不要自造 grid。
- 会变化的数字禁止使用比例数字；不要在 KPI 上再用 `text-3xl font-bold` 覆盖。

### 数据可视化

图表只表达数据，不表达“科技感”：

| 目的 | 图形 | 禁止 |
| --- | --- | --- |
| 单值 | `.data-readout` | 仪表盘、3D 数字 |
| 趋势 | sparkline / area | 双 Y 轴、渐变填充抢戏 |
| 构成 | stacked bar / dot plot | 饼图、甜甜圈 |
| 分布 | histogram | 3D、彩虹类别色 |
| 排名 | horizontal bar | 无排序的列表 |

- 数据墨水最小化：只保留一条基线，不画纵向网格；坐标轴不画盒子；直接标注替代 legend；默认不画数据点。
- 量值只用单一 accent；状态色只用于阈值/状态；类别色不扩成彩虹。
- 图表必须有标题、单位、时间范围、空数据/部分数据状态，并提供文本摘要或表格替代。

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
| 2. 可点击卡片 | 仅整卡可点击时 | `surface-panel-hover`（命名例外） |
| 3. 菜单 / popover | 下拉、菜单、分组浮层 | 复用组件自身阴影；不要手写 |
| 4. tooltip | 轻量提示 | `0 5px 14px rgba(0,0,0,.16)` |
| 5. 弹窗 / Sheet | modal、sheet | 现有 Modal / Sheet 的阴影 |
| 6. chrome | navbar、tabbar、侧栏 | `--app-glass-shadow` 或对应 chrome 类 |

- 统一使用中性投影；卡片、菜单和普通浮层保持向下、无水平偏移；底部 Sheet / tabbar 使用向上（负 Y）阴影。需要强调主操作时，用词重、填充色和尺寸，不要靠发光。
- 禁止用品牌色或状态色做模糊投影，也禁止零偏移的彩色光环（`0 0 0 3px` 配彩色）和彩色 `text-shadow`。
- 普通状态指示点的语义光环限制在扩散 ≤3px、透明度 ≤20%；`status-border-beam`（4px / 46%）和 `FloatingStatusIndicator` 的运行脉冲（4px / 70%，2s）是命名例外。
- 命名例外：`surface-panel-hover` 的 accent 20% 描边 + 9% 投影、`icon-well` 的 accent 12% 投影、`focus-visible` 焦点环属于现有交互态；不要把它们复制到静态内容或普通容器。
- 悬停和按下状态沿用同一套中性投影，只调整透明度；只有命名例外可以改变描边/光晕颜色。
- 深色主题不要新增更重的黑色阴影；现有 `surface-panel` 的深色阴影保持不变，新的层级优先通过表面色阶、1px 边框和 `--app-glass-border` 表达。
- 目标：把通用阴影抽成 `--app-elevation-1…4`，页面只引用 token；当前实现仍以类为主。

### 间距

基础尺度遵循 4px 基线：`--app-space-1` 至 `--app-space-6` 分别为 4、8、12、16、20、24px。语义间距的当前实际值（iOS 主题）：

| token | 桌面 | 手机 | 用途 |
| --- | --- | --- | --- |
| `--app-space-card` | 14px | 12px | 卡片内部、紧密列表 |
| `--app-space-panel` | 16px | 14px | 卡片内边距 |
| `--app-space-section` | 18px | 16px | 页面区块、主网格 |
| `--app-space-control-x` | 16px | 16px | 表单控件横向内边距 |
| `--app-space-page` | 20px | 18px | 页面外层 |

≤639px 的 `ios-theme.css` 覆盖全部语义间距：card 12 / panel 14 / section 16 / page 18，control-x 保持 16；`ios-workspace-page` 的 `app-stack-section` gap 1rem 和 ≤640px 的 card header/content/info padding 0.875rem 与这套值一致。`index.css` 的移动端基础块已同步为同一组值，但实际生效仍以 `ios-theme.css` 为准。

间距角色：

| 角色 | 建议 | 用法 |
| --- | --- | --- |
| inline | 4–8px | 图标与文字、紧凑标签 |
| inset / stack | 12–16px | 卡片内部、列表行 |
| section | 18–24px | 区块之间 |
| page | 20–32px | 页面外边距 |
| macro | 32–48px | 大段之间；用局部 token 或 `app-stack-section`，不要用 `p-6` 代替 |

Tailwind 映射：

| Tailwind | token |
| --- | --- |
| `gap-3` / `gap-4` / `space-y-4` | `--app-space-card` |
| `gap-5` / `gap-6` / `space-y-5` / `space-y-6` | `--app-space-section` |
| `space-y-3` | 未映射，仍是 12px |
| `p-*` / `px-*` / `py-*` / `m-*` | 未映射到语义间距，不要用它们做页面节奏 |

`gap-4` 是默认卡片间距，`gap-3` 只用于更紧的列表行；`gap-6` 只用于局部 section。页面级区块节奏统一用 `app-stack-section`，不要再散写 `space-y-6`、`gap-6` 或 `p-6` 来代替它。

### 卡片与容器

通用组件优先级：

1. 能用 `Card`、`CardHeader`、`CardContent`、`SmoothPanel` 时优先使用组件。
2. 特殊布局不适合组件时，使用语义类：`app-card surface-panel`、`app-card surface-soft`、`app-info-card`。
3. 不要把页面区块都做成层层嵌套卡片；只有真正需要框住的内容才使用卡片。

- `Card` 自身带 `--app-space-panel` 内边距；同时使用 `CardHeader` / `CardContent` 时必须加 `!p-0`，否则会出现外层 + header + content 三层内边距。正确写法见「页面骨架」。
- `Card` 没有 `hover` 属性，也不透传 `onClick`、`role`、`tabIndex` 或 `aria-*`。整卡可点击时使用原生 `<button type="button" className="app-card surface-panel [surface-panel-hover] ...">`，并补上「交互状态」里的 focus-visible 配方；或先扩展 `Card` 的 HTML 属性。
- 需要连续曲率但不是 `Card` 的面板时用 `SmoothPanel`；只有本身没有外阴影的圆角矩形才直接使用 `SmoothSurface`（从 `@/components/common/SmoothSurface` 直接导入，它不是公共导出）。
- 日志、终端、代码块使用 well；设备预览使用 viewport；不要把它们做成 raised card。

### 表单与按钮

新增表单优先使用 `Input`、`Select`、`Checkbox`、`Switch`。二元启停设置使用 `Switch`，多选或参数组合使用 `Checkbox`。多行文本和其他必须手写的原生控件使用：

- 输入控件：`app-input control-surface`
- 多行文本：`app-input control-surface !h-auto !min-h-28 resize-y px-3 py-2`（`app-input` 在手机上会被 `@media (pointer: coarse), (max-width: 768px)` 的 `height/min-height: 2.75rem !important` 覆盖；必须用 `!h-auto !min-h-28`）
- 复选项外层：`app-checkbox`
- 普通按钮：`app-button`
- 图标按钮：`app-icon-button`

iOS 风格三档 `Button` 高度由 `app-button-size-sm`、`app-button-size-md`、`app-button-size-lg` 统一管理，桌面分别为 36、44、48px；`Input` 和 `Select` 为 44px。手机断点和粗指针设备会把所有标准按钮、图标按钮与表单点击区提升到至少 44px。不要在调用处再叠加 `h-*`、`px-*`、`py-*` 缩小标准控件；图标专用工具条只有在桌面高密度场景才可明确使用更紧凑的尺寸，且不能承载文字。

`Switch` 的 `label` 只作为 `aria-label`，不会渲染可见文字；设置项必须在旁边另写可见标题和说明。`Card` 的标题由 `CardHeader` 渲染；不要再用 `h3` 手写一份同样的字号。

### 交互状态

所有交互控件必须覆盖下面这些状态；组件没有实现的，页面必须补：

| 组件 | 必须覆盖 |
| --- | --- |
| Button / IconButton | default、hover、pressed、focus-visible、loading、disabled |
| Input / Select | default、hover、focus-visible、error、disabled、read-only |
| Checkbox | checked、unchecked、indeterminate、disabled、error |
| Switch | on、off、disabled、loading |
| Row / Card（可点击） | default、hover、selected、focus-visible、disabled |
| Tab / Segmented | default、hover、selected/current、focus-visible、disabled |

规则：

- `pressed` 只做 `scale(0.97)` 或背景压暗，约 100ms，不改变布局；`hover` 约 160ms。
- `selected/current` 必须同时有表面填充、`aria-selected` / `aria-pressed` 和文字/图标提示，不能只靠颜色。
- `loading` 必须禁用重复提交，把 `aria-busy` 放在内容区；>1s 才显示骨架/进度，≤100ms 不显示指示器。
- `read-only` 与 `disabled` 不同：read-only 可聚焦、可复制，不触发校验；disabled 不可聚焦、不可点击。
- 脏数据（dirty）用保存条或行内标记提示；离开前用 ConfirmDialog 或路由拦截，不要静默丢失。
- 所有可点击元素必须有明确的 `focus-visible` 状态，不能只提供 hover。

焦点配方（手写控件复制其一，不要新写 `ring-2`）：

- `Button` / `IconButton`：`outline: 2px solid color-mix(in srgb, var(--app-accent) 62%, transparent); outline-offset: 2px`。
- `Input` / `Select`：复用组件；实际为 `border-color: var(--app-accent); box-shadow: 0 0 0 3px var(--app-accent-soft)`；borderless 页面是背景变化 + `0 0 0 3px` accent 16%。
- 手写 `button` / 可点击卡片：复制 `Button` 的 outline 配方，不要只加 hover。

`ios-borderless-cards`、`[data-automation-tasks]`、`[data-workbench-tasks]` 内的 `.app-native-control` 使用填充式聚焦：`border: 0; background: color-mix(in srgb, var(--app-accent-soft) 22%, var(--app-surface-muted)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent)`；不要覆盖。

### 状态与注意力

状态不是装饰。每个状态必须同时回答：**当前处于什么状态、用户能做什么、失败后怎么恢复**。

注意力层级：

| 层级 | 内容 | 规则 |
| --- | --- | --- |
| L0 ambient | 状态点、静态色、短文字 | 常态，同区域只允许一种颜色 |
| L1 live | 进度、tabular 数字、skeleton | 只出现在活动区域；持续 >1s 才显示 |
| L2 attention | 单条 beam / 脉冲 / 状态 chip | 视口内最多 1 个，只给正在执行的任务，可被停止 |
| L3 interruptive | Modal、ConfirmDialog、需要用户处理的错误 | 阻塞，必须有关闭或下一步 |

- 同视口 L2 不超过 1 个；L2 不得与 L3 同时争抢；静态卡片不得有循环动画。
- 错误只在需要用户决策时升级到 L3；成功态 3–5s 内静止；错误常驻但静态。
- `prefers-reduced-motion` 下 L2 降级为静态描边 + 文字，不丢失状态信息。
- 颜色不单独承载状态；必须有文字、图标或位置。
- 同一张卡禁止 beam + pulse + shine 叠加；未登记的动效（如 `dashboard-flow-shining-action`）要登记或删除。

### 动效

动效按下面的配方取用，不要所有场景都用 160ms：

| 场景 | 时长 / 参数 |
| --- | --- |
| 颜色、背景、阴影、普通变形 | 160–180ms |
| Switch 轨道 / 滑块 | 220ms ease / 240ms `cubic-bezier(0.22,1,0.36,1)` |
| 菜单、下拉 | 复用现有组件：主题菜单 spring `440/38/0.7`；自动化任务选择器 320ms `cubic-bezier(0.32,0.72,0,1)` |
| 弹窗 | spring `stiffness: 380, damping: 34, mass: 0.82` |
| 分段高亮 | spring `stiffness: 420, damping: 38, mass: 0.72` |
| Sheet | 现有 Sheet 的 `[0.32,0.72,0,1]` |

- 退出比进入快约 30–40%；浮层从触发点 origin 展开；优先使用可反向中断的过渡。
- 新增 CSS 或 Framer Motion 动效必须尊重 reduced motion；关闭位移、旋转和弹簧，只保留必要的透明度变化。
- `status-border-beam` 仅用于启动、连接或执行中的局部状态反馈，并通过 `is-active` 控制；完成、空闲和静态卡片不得常驻光效。

### 反馈状态

按下面顺序选择反馈方式，不要用空状态伪装错误，也不要为同一结果重复显示多种提示：

| 情况 | 使用方式 |
| --- | --- |
| 字段校验失败 | `Input`、`Select` 的 `error` prop；`hint` 只在没有错误时显示 |
| 控制台首次且没有本地缓存 | 控制台骨架；恢复或返回页面时先显示最后一次成功快照并后台刷新，不要重播整页骨架 |
| 懒加载路由 | `PageSkeleton variant={routeId}`；支持 dashboard / automation / combat / roguelike / training / logs / statistics / config，其他 id 只有页头骨架 |
| 局部内容正在读取 | `Loading` |
| 列表、流程或卡片无数据 | `EmptyState`，按容器选择 `compact` |
| 区域读取失败 | 在原区域显示可恢复的错误与重试操作；不要改成空状态 |
| 全局结果与错误 | `useStatusStore.setMessage`，由 `FloatingStatusIndicator` 展示；错误不自动收起，由下一次操作或页面生命周期清除 |
| 删除、清空等不可逆操作 | `ConfirmDialog`；新代码不得使用 `window.confirm` |

日志控制台、养成筛选空结果等固定高度或高密度区域可保留专用状态样式。局部表单成功提示、日志提示等需要紧邻操作区或可手动关闭时，也可保留在面板内。项目没有通用 Toast 组件，`FloatingStatusIndicator` 是全局任务状态和短消息载体，不应被当作普通 toast 复刻。

`ConfirmDialog.onConfirm` 可以返回 Promise。返回 `false` 或抛出错误时弹窗保持打开；错误会在弹窗内展示，调用方不要提前关闭弹窗或吞掉失败结果。

### 图标

- 普通功能图标优先使用已引入的 `lucide-react`；业务身份和概览图标优先复用 `Icons.tsx`。一级工作区标题与控制台一致，不添加装饰图标；不要在普通页面重复手写 SVG。
- 行内或文字旁图标使用 16px，常规操作和字段图标使用 20px，页面标题或大操作使用 24px。线宽使用 1.8–2.0；11–14px 的小箭头可用 2.1–2.4 补偿。
- `icon-well` 只用于页面、概览和卡片的内容身份图标，不能包裹普通按钮图标；它是阴影规则的命名例外。
- 无文字操作使用 `IconButton`，调用时必须提供 `aria-label`，并提供 `title` 或 `tooltip` 作为提示；只传 `tooltip` 时不能省略 `aria-label`。有文字的操作使用 `Button icon`。
- `IconButton` 的 `sm`、`md`、`lg` 与相同档位的 `Button` 共用尺寸，并在手机和粗指针设备保持至少 44px。不要页面自行缩小点击面积；桌面高密度工具条使用 `IconButton size="sm"`（36px）。
- 装饰图标加 `aria-hidden="true"`；状态和结果必须同时提供可读文字或 `aria-label`，不能只依赖颜色和图标。

按钮颜色按语义选择 `brand-action`、`status-success-action`、`status-danger-action`，不要按页面重新定义按钮渐变。

### 响应式策略

布局按“层级 × 机制”选择，不要只按手机/桌面两个词：

| 层级 | 机制 | 规则 |
| --- | --- | --- |
| 页面壳 | viewport `sm/md/lg/xl` | 只在 shell 层使用断点；不要再加 899/1023 页面级断点 |
| 区块 | `@container` + `minmax(0,1fr)` | 双栏/三栏按容器宽度折叠，不按设备猜 |
| 卡片内部 | `container-type: inline-size` | 卡片在窄容器里自动改单列/紧凑行 |
| 控件簇 | `pointer: coarse` / `hover: hover` | 粗指针 ≥44px；仅在支持 hover 时使用 hover 效果 |
| PWA | `display-mode: standalone` | 安全区、tabbar、底部留白 |
| 安全区 | `env(safe-area-inset-*)` | chrome 自己处理，内容区不重复 |

- 新页面按 mobile-first 编写；`sm` (640px) 显示次级信息，`md` (768px) 中等布局，`lg` (1024px) / `xl` (1280px) 才扩展多栏。
- 移动端转换按原型执行：设置页单列 + 吸底保存；统计页 KPI 2 列 + 筛选收进触发按钮；日志页工具栏两列 + 控制台高度 clamp；详情页操作换行 + 元数据 2 列。
- 文本和控件自然换行，不允许为了保留桌面布局裁剪有效内容；`PageHeader` 副标题在 <640px 仍会隐藏，必要信息改用可见一行或页内说明。
- 页面滚动条当前全局隐藏；需要滚动位置线索时使用现有滚动容器的渐隐/自定义指示器，不要直接恢复系统滚动条。

### 布局密度

- 常规内容宽度由 `Layout` 的 `.la-pluma-content` 决定（桌面 112rem，扣 17rem 侧栏），页面内部避免再套一层同用途的宽度和 padding 容器。
- 区块间使用 `app-stack-section`，卡片内使用 `app-stack-card`。只有内容可独立扫描、操作或滚动时才使用卡片；内部分区优先用 `CardHeader`、`CardContent`、分隔线、网格或 `surface-soft`。
- 常规信息卡片使用 `repeat(2, minmax(0, 1fr))`；主次栏建议保持约 `1.1–1.75 : 0.9–1`，工具/筛选窄栏最小约 `16rem`，主内容必须保持弹性。每一列都应有 `minmax(0, ...)` 或 `min-w-0`。
- 页面标题当前是 30px/700，KPI 也是 30px；同屏出现时，KPI 使用 `.data-readout-value.is-primary` 的 600 字重，标题保持 700；更推荐让 KPI 降一档，避免两个 30px 主角。
- 不要为了填满右侧留白而硬塞第二张卡，也不要把普通页面区块做成卡片嵌套卡片。独立工作区、弹窗、空状态和设备预览属于合理例外。
- 自动化编排器、肉鸽工作区是高密度专用布局：前者按三栏/两栏/单栏专用断点折叠，后者在窄屏转单栏。它们不是新页面的默认模板。

---

## 模式库

### 覆盖层

| 场景 | 组件 | 规则 |
| --- | --- | --- |
| 删除、清空、不可逆操作 | `ConfirmDialog` | 标题写“动词 + 对象”，正文写后果与可逆性；异步失败保持打开 |
| ≤6 字段的短表单 | `Modal`（从 `@/components/common` 导出） | size `sm/md/lg/xl` = 28/32/42/56rem；焦点陷阱、关闭归还、滚动锁由组件处理 |
| 长表单、多分组 | 独立路由页 | 不要塞进 Modal；保存条固定在页面或 section |
| 筛选、排序 | 页内筛选菜单（参考 DataStatistics 的 FilterMenu，不是公共组件） | 不遮挡主内容；关闭后焦点回触发按钮 |
| 页面导航 | `Layout` 的 Sheet | Sheet 是 Layout 内部导航组件，不是 `@/components/common` 的公共导出；页面不要自行复刻 |
| 详情 | 路由 + 返回 | 返回保持列表滚动位置 |

### 设置页

- 布尔/短枚举：行内 label + 说明 + 右侧控件；文本/密钥/数字：label 在上、全宽；成对短字段 `md` 起两列。
- 分组用 `CardHeader` + 分隔行；不要用嵌套卡片。危险区固定在最后，使用 `status-danger` 语义。
- 默认按 section 显式保存：pristine 禁用保存，保存中锁本节，失败保留草稿并就地报错，成功给短暂状态。
- 有未保存改动时，重置走 `ConfirmDialog`；离开页面提供拦截或保存提示。
- `Switch` 的 `label` 只作 `aria-label`；可见标题和说明必须另写。

### 列表与表格

| 场景 | 形式 |
| --- | --- |
| ≤7 项、以浏览为主 | 卡片网格 |
| 多属性比较 | 表格 / 紧凑行 |
| 时间序列 | 日志 / 时间线 |
| 层级数据 | 树 / 分组列表 |

- 行高：桌面 comfortable 44 / compact 36；移动 64；分隔用 1px `--app-border`，禁止斑马纹。
- 表头 `text-xs/600 text-secondary`，可吸顶；数字列右对齐 + `tabular-nums`；状态居中。
- hover 只用于可操作行；selected 用 `surface-soft` + accent 指示 + `aria-selected`；批量选择用 Checkbox + 顶部批量条，支持 indeterminate。
- 排序用 `aria-sort`，只允许单列主排序；筛选无结果 ≠ 暂无数据，必须提供“清除筛选”。
- 分页/加载更多/虚拟滚动按数据量选择；超过 200 行优先虚拟滚动。

### 日志与详情页

- 结构：PageHeader + 模式标签 + 工具栏 + 控制台 well + 可选历史列表。
- 控制台固定高度 `height: clamp(20rem, 55dvh, 28rem)`，只有控制台内部滚动；用户上滚即暂停自动滚动，显示“回到最新 · n 条”。
- `role="log"` / `aria-live="polite"` 只在自动滚动开启时使用；上下渐隐表示可滚动。
- 行解剖：时间 11px meta、级别用状态色 + 文字、消息主体、可复制标识；复制/导出放工具栏。
- 详情页：标题可换行，操作放第二行，元数据 2 列；返回保持列表位置。

### 键盘与屏幕阅读器

| 模式 | 要求 |
| --- | --- |
| Tab / Tablist | roving tabindex，方向键切换，Home/End 首尾 |
| Menu | 方向键、Enter/Space、Escape 关闭并归还焦点 |
| Dialog / Sheet | 打开聚焦第一个可操作项，破坏性操作默认聚焦取消；Esc 关闭；关闭归还触发元素 |
| 路由切换 | 焦点移到 main 或 h1，播报页面名 |
| 表单错误 | `aria-invalid` + `aria-describedby`；错误摘要可聚焦 |
| 全局播报 | 只保留一个 polite live region；`role="alert"` 只用于需要用户处理的错误 |
| 列表 | 选中/当前项有 `aria-selected` / `aria-current`；批量操作有可读数量 |

验收：仅键盘完成主流程；焦点不被遮挡；200% 缩放和 320px 宽不横向滚动；`prefers-contrast: more` 和 `forced-colors: active` 下仍可用；读屏名称不为空。

---

## 内容设计

界面文案是设计系统的一部分，不是开发者随手写的占位。

- 语气：直接、具体、可执行；不用“操作成功”“系统异常”“未知错误”这类空话。
- 按钮：动词 + 对象（开始执行、保存设置、导出数据）；破坏性操作写清对象和数量（“删除 3 条记录”），并说明不可撤销；取消统一写“取消”。
- 错误：模板为“对象 + 发生了什么 + 影响 + 下一步”；字段错误就地显示，区域错误带重试，全局错误给恢复路径。
- 空状态：事实标题 + 为什么为空 + 如何产生数据 + 一个主操作；筛选无结果要提供“清除筛选”。
- 确认框：标题 = 动词 + 对象；正文 = 后果与可逆性；确认按钮重复动词，不要只写“确定”。
- loading：带对象和进行时（“正在保存设置…”），不用无主语的“加载中”。
- 状态词表：运行状态以 `AgentRunState` 为准——accepted=已接受、waiting=等待中、running=执行中、stopping=停止中、succeeded=已完成、failed=失败、stopped=已停止、interrupted=已中断；检查中/连接中只用于 preflight，warning/error/info 只用于反馈类型，不要再造 queued / done 等同义词。
- 数字、单位、日期按「文字层级」的格式表；缺失值统一 `—`。
- 游戏术语固定：干员、精英化、材料、关卡、肉鸽、理智；不要混用英文缩写或同义词。

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
| 表单 | `Input`、`Select`、`Checkbox`、`Switch`；多行文本用带 `app-input control-surface !h-auto !min-h-28 resize-y px-3 py-2` 的原生 `textarea` |
| 空状态 | `EmptyState`，只用于确实没有数据 |
| 不可逆操作确认 | `ConfirmDialog` |
| 局部加载 | `Loading`；懒加载路由用 `PageSkeleton`；控制台骨架从 `@/components/common/Loading` 直接导入 |
| 任务状态环 | `StatusMark`（从 `@/components/common` 导出） |
| 动态分段标签 | `useFluidTabIndicator` |
| 覆盖层 | 先看「模式库 / 覆盖层」；`Sheet` 不是公共组件 |

### useFluidTabIndicator

**文件位置**：`client/src/hooks/useFluidTabIndicator.ts`

**适用场景**：带有 Framer Motion 高亮底层的分段标签。它会在切换、容器尺寸变化、标签内容变化和窗口缩放时，把高亮层对齐到当前按钮。不要在每个页面重复维护 `ResizeObserver`、元素 ref 和坐标计算。

```tsx
const { containerRef, activeRect, setTabRef, handleTabKeyDown } = useFluidTabIndicator(activeTab)

<div
  ref={containerRef}
  className="relative"
  role="tablist"
  onKeyDown={(event) => handleTabKeyDown(event, tabs.map(tab => tab.id), setActiveTab)}
>
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
    <button
      key={tab.id}
      ref={setTabRef(tab.id)}
      role="tab"
      aria-selected={activeTab === tab.id}
      tabIndex={activeTab === tab.id ? 0 : -1}
    >
      {tab.label}
    </button>
  ))}
</div>
```

标签 ID 需是字符串联合类型，且高亮容器需要 `relative` 定位。高亮层必须带自己的背景/圆角，否则复制的示例不可见。

---

## 重构建议

新增页面或改老页面时按这个顺序：

1. 先声明页面原型（运行台 / 数据 / 日志 / 编排 / 设备 / 设置），不要直接套同一套骨架。
2. 页面外层 `app-page`（非 Dashboard 再加 `ios-workspace-page`，需要无边框分组卡时加 `ios-borderless-cards`），标题使用 `PageHeader` + `mobileLayout="inline"`。
3. 大面板使用 `Card` 或 `SmoothPanel`；使用 `CardHeader` / `CardContent` 时给 `Card` 加 `!p-0`；日志/设备/代码块用 well / viewport，不要用 raised card。
4. 表单、按钮、空状态、加载、覆盖层按「组件选型」和「模式库」选择，不要手写等价实现。
5. 覆盖状态矩阵：hover / pressed / focus / selected / indeterminate / loading / disabled / read-only / error / dirty。
6. 文案、数字格式、键盘和读屏按「内容设计」「键盘与屏幕阅读器」处理。
7. 按下面「新增页面验收清单」自检，再交付。

### 新增页面验收清单

- [ ] 页面原型明确；骨架包含 `app-page`、必要的 `ios-workspace-page` / `ios-borderless-cards`、内层 `app-stack-section`。
- [ ] `PageHeader` 使用 `mobileLayout="inline"`；没有重复的宽度容器或水平 padding。
- [ ] 使用 `CardHeader` / `CardContent` 的卡带了 `!p-0`；静态卡片没有 hover 位移；日志/设备使用 well / viewport。
- [ ] 每个区域最多一个 raised surface；没有玻璃叠玻璃；reduced-transparency 下有实色回退。
- [ ] loading / empty / error / disabled / selected / pressed / dirty / 长标题 / 长操作文案都检查。
- [ ] 375 / 768 / 1280 三个宽度、浅色/深色/增加对比度都看过；没有横向溢出。
- [ ] 所有交互控件有 `focus-visible`、disabled、loading；触控目标 ≥44px。
- [ ] 键盘可完成主流程；Modal/Sheet 焦点陷阱和归还正常；错误有 `aria-invalid` / 播报。
- [ ] 没有新增页面级颜色、彩色阴影、彩色光环、未登记的 z-index；游戏语义色面积 ≤10%。
- [ ] 会变化的数字使用 `tabular-nums`；正文对比度和非文本对比度按「色彩」表核对。
- [ ] 文案按「内容设计」模板；数字/单位/日期格式统一。

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
- [ ] 为六个页面原型各保留一张参考截图（浅色/深色、桌面/移动），作为视觉回归基线。

---

## 当前实现备注

下面这些是当前实现与规范的已知差异/备注。新增代码按规范写。

- **Liquid Glass 27 材质**：当前 `ios-theme.css` 仍是固定 glass token + 自定义边缘；`regular / clear / tinted` 和 `--app-material-*` 尚未落地。
- **品牌内容层**：当前只有系统蓝；`--app-ink-wash`、品牌触点、`--game-rarity-*` 尚未落地。
- **token 三层架构**：当前仍是 `index.css` / `ios-theme.css` 双文件字面值；primitive/semantic/component 分层是目标。
- **连续圆角**：`SmoothPanel` / `SmoothSurface` 的 20/16 是 TS 常量，不是 token；组件源码已注明与 `--app-continuous-radius` / `-compact` 同步。
- **`FloatingStatusIndicator`**：当前没有关闭按钮；错误不会自动收起，只能被下一次消息或页面生命周期清除。
- **手写控件 `ring-2`**：现有约 10+ 处仍使用 `focus-visible:ring-2`；目标是迁移到 Button 的 outline 配方，新代码不要新增。

---

**创建时间**：2026-02-09
**最后更新**：2026-11-05
**维护者**：@mps233
