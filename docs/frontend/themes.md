# 主题系统与新增主题契约

> [← 返回前端架构](README.md)

主题系统把「明暗模式」与「界面主题」分开：模式决定 `light`/`dark`/`system`，主题决定是否在 shadcn 语义变量之上叠加额外的视觉包。当前只注册了 `default` 主题；默认主题不写 `data-theme`，完全保持 shadcn 基线。液态玻璃等额外主题只能作为可整体卸载的独立主题包接入。

## 主题与模式

- **模式**：`light`、`dark`、`system` 由 `ThemeProvider` / `useTheme` 管理，同时给 `html` 与 `#app-root` 加 `.dark`。组件与页面不得自行操作 `.dark` 或创建局部主题开关。
- **设置存储**：模式与 `themeId` 一起持久化在 `lpn-ui`。旧 zustand persist 键 `ui-storage` 只在升级迁移时读取，任何路径都不得再写入。
- **注册表**：`apps/web/src/shared/theme/registry.ts` 的 `THEMES` 是唯一注册点，`ThemeDefinition` 包含 `id`、`name`、`description`、`boot.light`/`boot.dark`（`background`、`themeColor`、`statusBar`）与 `swatches`。
- **默认主题**：`DEFAULT_THEME_ID = 'default'` 是特殊 id，选择它时移除 `html[data-theme]`；其他主题写入 `data-theme="<id>"`。
- **首帧**：`createBootScript()` 在构建期序列化 `ThemeDefinition.boot` 并注入 `index.html`，首帧即应用目标背景、`theme-color` 与状态栏样式。PWA manifest 的 `theme_color` 是静态默认值，运行时观感由启动脚本改写 meta。

设置页「外观」卡片直接读取 `THEMES`，新增注册项后无需再改页面。

## 三层模型

| 层 | 内容 | 归属 |
| --- | --- | --- |
| Tier 1 | shadcn 语义 CSS 变量（`--background`、`--card`、`--primary` 等） | `src/styles/index.css` 的 `:root`、`html.dark, #app-root.dark` 与媒体查询 |
| Tier 2 | 主题私有材质变量，使用主题自有前缀（液态玻璃为 `--glass-*`） | 主题包的 `tokens.css` |
| Tier 3 | 皮肤层 CSS，锚点仅限 shadcn 组件的 `data-slot` 与应用语义区域的 `data-region` | 主题包的 `skin.css` |

Tier 3 的红线：不改 DOM、不动交互度量、只动视觉材质（背景、边框、阴影、`backdrop-filter`、圆角、字重、图标线宽）。主题不得新增页面级类名，也不得要求页面为它增加包装元素。

## 主题包形态与卸载契约

新增主题必须满足以下形态：

1. 主题目录 `apps/web/src/themes/<id>/tokens.css` 与 `skin.css`；
2. `registry.ts` 中恰好一条 `ThemeDefinition` 注册项；
3. `src/styles/index.css` 末尾的两条 `@import`（或等价的单一入口）。

卸载契约：删除主题目录、注册项与这两条导入后，应用必须在 shadcn 基线上完整可用。默认基线因此不得引用任何主题私有变量、类名或锚点；主题也不能成为页面结构、交互或数据的前置条件。

默认基线保持实色：不使用 `backdrop-filter` 作为表面材质、半透明玻璃背景或主题私有材质（shadcn 生成弹层的遮罩 scrim 除外）。chrome 与召唤层由语义表面、发丝线和实色阴影构成；`styles/chrome.css` 只承载 chrome 视觉，不是主题包。

## 视觉与可访问性要求

- 主题必须同时提供浅色与深色取值；首帧色卡写入 `ThemeDefinition.boot`。
- 主题包在自己的皮肤层内处理 `prefers-reduced-motion`、`prefers-reduced-transparency: reduce` 与 `prefers-contrast: more`，不得依赖基线替它降级。
- 视觉验收使用主题画廊的「主题 × 模式」矩阵与启动首帧；新增主题需要记录结构依据并人工核对深浅模式。
- 普通卡片始终不透明；玻璃或半透明材质只用于明确的 chrome、浮层或主题声明的表面，避免整页透明导致可读性下降。

## 新增主题 checklist

1. 建主题目录，按 Tier 1/2/3 拆分 `tokens.css` 与 `skin.css`；变量加主题前缀，锚点只用 `data-slot` / `data-region`。
2. 在 `registry.ts` 注册 `ThemeDefinition`，补齐名称、描述、首帧色卡与色卡展示项；`default` 保持零覆盖。
3. 在 `index.css` 末尾接入导入；确认移除主题包后基线仍完整可用。
4. 验证设置页「外观」自动出现新主题，`data-theme` 的写入/移除与 `lpn-ui` 恢复正确。
5. 在主题画廊核对「主题 × 模式」矩阵与启动首帧，记录结构依据。
6. 补齐 reduced-motion / reduced-transparency / contrast 降级。
7. 文档只在此处维护主题契约；视觉规则留在 [设计规范](../../DESIGN.md)，不复制 token 表。

## 当前基线

- 仅注册 `default`；默认主题不写 `data-theme`。
- `apps/web/src/styles/chrome.css` 是默认主题的 chrome 视觉样式，不含 `--glass-*`、`backdrop-filter` 或连续曲率。
- 主题菜单与 PWA 提示使用 `surface-panel` 的实色表面；PWA 安装入口使用 shared `Button` 的 `secondary` 变体。
- 移动 tabbar 与悬浮控件的抬升使用语义阴影 `--shadow-floating`，不依赖玻璃材质。
