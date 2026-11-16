# 依赖与职责护栏

> [← 返回文档索引](../README.md)

本文说明自动检查：功能域依赖环、公开面与分层方向、非页面微域的反向依赖、页面裸副作用、布局壳层锚点、全局样式作用域与布局测试细节。规则实现在 `apps/web/scripts/guardrails.ts`，CLI 为 `apps/web/scripts/check-guardrails.ts`，已接入客户端 `verify`。

它只做静态事实判断，不证明运行时所有权，也不替代[执行客户端](../architecture/execution-client.md)、[配置持久化协调器](../architecture/config-persistence.md)或[Query 缓存](../architecture/query-cache.md)的行为契约。

## 1. 定位与边界

| 检查 | 目标 | 失败方式 |
| --- | --- | --- |
| 功能域依赖环 | `features/*` 折叠成节点后的强连通分量必须为空 | 失败并打印一条环路径 |
| 公开面与分层 | `app → pages → features → shared`；跨域只能经 `@/features/<domain>` 根入口；pages 只向下组合，shared 不依赖 features/pages/app，features 不依赖 pages/app | 失败并指出文件与 import |
| 非页面微域反向依赖 | `features/task-execution` 只能依赖 `shared` 与自身 | 失败并指出目标域 |
| 页面裸副作用 | 页面文件不得直接持有传输、存储或轮询原语 | 失败并指出原语/import |
| 布局壳层锚点 | `Layout`、导航壳与 `PageShell` 的稳定 `data-region` / `data-page-*` 锚点必须存在 | 失败并指出文件与缺失锚点 |
| 全局样式作用域 | 三个全局样式文件不得包含页面/领域选择器 | 失败并指出文件、行号与命中片段 |
| 布局测试细节 | `src/**/*.layout.test.tsx` 不得锁定类名、内联样式、类选择器、兄弟顺序或精确滚动参数 | 失败并指出文件与行号 |

范围：

- 依赖检查读取 `apps/web/src/**/*.{ts,tsx}` 的生产源码；`*.test.*` 与 `*.spec.*` 不进入运行时依赖图。测试可以为隔离而接触内部实现，不会进入生产包。
- 页面检查只针对 `pages/*/*.{ts,tsx}` 生产文件；`components/`、`hooks/`、`model/` 等领域容器不受页面限制。
- 布局锚点检查读取五个固定壳层文件；文件或锚点缺失即失败，只检查存在性，不声称唯一性。
- 全局样式检查读取 `src/styles/index.css`、`layout.css`、`ios-theme.css`；剥离注释后只匹配 `{` 前的选择器 prelude，文件缺失即失败。
- 布局测试检查读取 `src/**/*.layout.test.tsx`；未发现任何布局测试时同样失败，避免过滤或 glob 失效后静默通过。

## 2. 依赖与公开面

### 2.1 规则

`app → pages → features → shared` 是唯一允许的分层方向。具体判定：

| 违规 | 例子 | 原因 |
| --- | --- | --- |
| `layer-direction` | `shared/**` import `@/features/x`、`@/pages/...` 或 `@/app`；`features/**` import `@/pages/x/Page`、`@/app` 或 `@/main` 等根入口模块；`pages/**` import `@/app` 或根入口 | 下层不得反向依赖上层，根入口只组装 app |
| `deep-import` | `features/a/**` import `@/features/b/model/x`；`app/**` import `../../features/b/components/Workspace` | 功能域对外只有 `index.ts` 一个公开面 |
| `deep-import` | `pages/a/Page.tsx` import `@/features/a/model/x`（生产代码） | 页面只经功能域根入口组合；页面测试可深路径构造领域状态 |
| `deep-import` | `features/a/**` 用 `@/features/a/...` 访问自身内部 | 同一域内应使用相对路径，避免经公开面形成内部环 |
| `deep-import` | 跨域使用相对路径，即使最终落在 `features/b/index.ts` | 跨域必须显式使用 `@/features/<domain>` 根入口，避免路径迁移时绕过公开面 |
| `task-execution-reverse` | `features/task-execution/**` import `@/features/runtime-status` 或其他页面域 | `task-execution` 是跨页面微域，只持有命令/控制器；`runtime-status` 单向消费它的运行投影 |

允许的跨域方向当前包括：

- `automation`、`combat`、`dashboard`、`roguelike`、`settings`、`statistics`、`training` 等页面域按需读取彼此的公开面；
- `statistics → training` 是单向使用队列/材料命令，不是共享资源的第二份归属（[共享资源归属与失效端口](../architecture/resource-ownership.md) 第 3 节）；
- `runtime-status → task-execution` 是运行快照的消费方向，不反向写运行状态。

域环按强连通分量判空，不要求页面域之间零 import。当前依赖图无环；`task-execution` 只依赖 `shared`。

### 2.2 与 ESLint 的分工

`apps/web/eslint.config.js` 继续负责编辑器内的快速反馈：拦截 `@/features/<domain>/...` 深路径、features/shared 反向依赖 app 或 pages、shared 依赖 features/pages，以及 pages 反向依赖 app。页面测试（`src/pages/**/*.test.tsx`）允许深路径到被测域内部以构造领域状态，不进入产物；CLI 的生产依赖图同样跳过测试文件。CLI 额外解析相对路径、目录 index 与动态 import，因此能发现 ESLint 字符串规则看不到的公开面绕过与真实域环。两处规则的权威事实都来自 `app → pages → features → shared`，新增边界时先更新本文与脚本，再考虑 ESLint 的即时提示。

## 3. 页面职责

页面只负责页面壳、工作区与领域容器的组合。以下原语不能出现在 `pages/*/*` 的生产文件中：

| 类别 | 禁止项 | 归属 |
| --- | --- | --- |
| 传输 | `@/shared/api`、`@/shared/query`、`@tanstack/react-query`；裸 `fetch`、`WebSocket`、`EventSource`、`XMLHttpRequest` | 领域 `api/`、领域 Query 与 Query Provider |
| 领域端点转发 | 经 `@/features/<domain>` 公开面导入该域 `api/` 再导出的函数（例如 `executeScheduleNow`、`saveUserConfig`，含 `export * from './api'` 以及同文件 `import ... from './api'` 再 `export { ... }`/`export default ...` 的本地转发），或命名空间/动态 import 后实际访问这些端点 | 领域容器与领域 hook；公开面对页面只导出页面/hook/组件与明确允许跨域读取的 query，§2.1 允许方向的跨域领域命令（如 training 的材料/计划/队列命令）不在此限 |
| 本域 API | 页面 import 本域的 `../api`、`../api/*` 或 `@/features/<own>/api` | 领域容器与领域 hook |
| 存储 | `localStorage`、`sessionStorage`、`indexedDB` | user-config 协调器、领域所有者或面板会话 |
| 轮询 | `setInterval` | 领域 hook / 流 / 会话所有者（例如实时日志、设备采样） |

页面可以调用所属领域的 hook 与容器，例如 `Dashboard` 调用 `useDashboardSnapshotRefresh`、导入 `DashboardWorkspace`。这些调用不会被误判为页面裸副作用；检查只看页面文件自身是否直接持有上述原语。端点检查会沿公开面的 `export { ... } from './api'`、`export * from './api'` 与同文件 `import ... from './api'` 的本地命名/默认/命名空间转发定位导出名来源；静态命名导入、命名空间导入、自域 `@/features/<domain>/api` 与字面量 `import('@/features/<domain>')` 都会检查。成员使用分析会解开 `as`/括号/非空/`satisfies` 包装，跟随本文件内的简单别名（变量声明、参数默认值、赋值解构、字面量计算键）与 `.then` 回调（回调本身带包装也可识别）；命名空间/动态导入只在页面实际访问了 `api/` 导出名时才违规，只用 hook/组件时允许；整条 import 只是类型时跳过。全局原语检查同样接受字符串字面量下标（含包装与 `['fetch']` 形式的绑定/赋值键）、`window.window` 等同名属性链、`window.top`/`parent`/`frames` 代理、`document.defaultView` 及其 `window.document`/`globalThis['document']` 变体，以及从这些全局对象经变量声明、解构参数默认值或赋值解构（含嵌套对象模式）重命名后的直接调用。`setTimeout`、`requestAnimationFrame` 与 DOM 事件不计为业务轮询，避免把布局/交互副作用一并禁掉；如果一个页面用递归 `setTimeout` 模拟轮询，仍然逃不过代码评审，本文不声称静态检查能识别所有轮询写法。

## 4. 布局壳层锚点

`layout-region` 用声明式锚点表核对壳层稳定锚点：

| 文件 | 必须存在的锚点 |
| --- | --- |
| `src/app/layout/Layout.tsx` | `data-region="scroll"`、`data-region="page-content"` |
| `src/app/layout/AppNavbar.tsx` | `data-region="navbar"`、`data-region="page-header"`、`data-region="page-title"` |
| `src/app/layout/AppSidebar.tsx` | `data-region="sidebar"`、`data-region="sidebar-brand"` |
| `src/app/layout/AppTabbar.tsx` | `data-region="tabbar"` |
| `src/shared/components/PageShell.tsx` | `data-region="page"`、`data-page-kind`、`data-page-layout`、`data-page-surface` |

判定基于 TSX AST 的 JSX 属性：带值锚点要求字面量值匹配，`data-page-kind` 等只要求属性存在。规则只检查存在性，不检查数量、位置、条件渲染或运行时可见性；同一锚点重复出现不会失败，唯一性与实际作用仍由 `app.pw.ts` 的浏览器断言和评审确认。

## 5. 全局样式作用域

`global-style-scope` 检查 `src/styles/index.css`、`src/styles/layout.css` 与 `src/styles/ios-theme.css` 的选择器 prelude（`{` 之前、剥离 CSS 注释后）。禁止：

- `[data-page-kind` 属性选择器；
- 领域类前缀：`automation-`、`combat-`、`roguelike-`、`training-`、`statistics-`、`logs-`、`dashboard-`、`settings-`、`config-`。

声明值与注释中的同名文本不参与匹配；命中时输出文件、行号与选择器片段。`@media`、`@supports`、`@layer` 等 at-rule prelude 会被跳过，但其中嵌套的规则选择器仍会检查。

## 6. 布局测试细节

`layout-test-detail` 检查 `src/**/*.layout.test.tsx`，禁止锁定以下实现细节：

| 禁止项 | 原因 |
| --- | --- |
| `toHaveClass(`、`toHaveStyle`、`classList` | Vitest 不求值样式表，类名与内联样式断言只核对 JSX 字符串或内联值 |
| `querySelector('.`、`querySelectorAll('.` | 通过类名定位 DOM 会锁死样式实现，改用 role、label 或 `data-*` 语义锚点 |
| `.style.width`、`.height`、`.top`、`.left`、`.right`、`.bottom`、`.display`、`.maxHeight` | 直接读取内联样式，锁死实现而非用户可见结果 |
| `data-align` | 依赖内部对齐属性 |
| `previousElementSibling`、`nextElementSibling` | 依赖 DOM 兄弟顺序 |
| `toHaveBeenCalledWith`、`toHaveBeenLastCalledWith` 中包含 `behavior` / `block` | 锁定 `scrollIntoView` 的精确参数 |

`scrollIntoView` 仅作为 jsdom prototype stub 出现是允许的；注释不参与匹配。失败信息包含文件与行号。

## 7. 接入与验证

```bash
# 依赖 + 页面职责 + 布局治理（客户端 verify 的第一步）
pnpm --filter la-pluma-next-client guardrails

# 客户端完整质量门禁
pnpm --filter la-pluma-next-client verify
```

本地 `pnpm verify` 包含护栏与样式预算 `stylelint:ratchet`；CI 将它们作为客户端检查的独立步骤运行。

回归集中在 `apps/web/scripts/guardrails.test.ts`：

- 正例：跨域公开面 import、同域相对 import、shared import、领域容器使用 fetch/计时器、页面经 `@/features/<domain>` 调用领域 hook、命名空间/动态导入只用领域 hook、页面仅 type-only 导入传输层类型、类型引用与 `typeof fetch` 等 TypeQuery、模块级同名本地 helper、import/export 别名与非全局赋值解构不误报、壳层锚点齐全、全局样式声明值与注释中的同名文本、顶层 at-rule 语句后的真实选择器、布局测试的 prototype stub 与行为断言；
- 反例：深路径、跨域相对绕过、shared→features、features→app、features→根入口、task-execution→runtime-status、双域依赖环、页面直接 import 传输层、页面经公开面（含 `export *`、同文件 `import`/`export` 的本地命名/默认/命名空间转发、`export * as`、命名空间、字面量动态 import）导入领域端点、页面导入本域 `@/features/<domain>/api` 或经根入口命名空间/动态 import 调用本域端点、页面使用 `fetch`/`WebSocket`/`localStorage`/`setInterval`（含 `window[...]` 计算属性与 `['fetch']` 字面量计算键、`window as any`/非空断言/括号包装、从全局对象变量声明/解构参数默认值/赋值解构（含嵌套对象模式）重命名、`window.window` 属性链、`window.top`/`parent` 代理与 `document.defaultView` 及其 `window.document` 变体）、命名空间/动态 import 经 as/非空/括号/satisfies 包装、局部别名、参数默认值/赋值解构/字面量计算键或 `.then` 包装回调访问端点、缺失壳层文件或锚点、全局样式中的页面/领域选择器、布局测试中的类名/内联样式/类选择器/兄弟顺序/精确滚动参数；
- 当前源码树：无依赖/页面/布局治理违规。

## 8. 已知限制

- 静态分析只能证明 import 与字面原语，不证明运行时谁真正写状态；跨 remount 的所有权仍需行为测试。
- 页面检查不覆盖 `document.*` 监听、递归 `setTimeout` 轮询、由变量或字符串拼接生成的动态 import；这些仍由评审与领域测试把关。
- 页面全局扫描支持 `window`/`globalThis`/`self` 的点访问、字符串字面量下标（含包装）与 `['fetch']` 形式的绑定/赋值计算键、`window.window` 等同名属性链、`window.top`/`parent`/`frames` 代理、`document.defaultView`（含 `window.document.defaultView` 与 `globalThis['document'].defaultView`）、变量声明/解构参数默认值/赋值解构（含嵌套对象模式，如 `const { fetch: f } = window`、`({ a: { fetch: f } } = window)`），并跳过类型引用/属性名/TypeQuery（如 `typeof fetch`、`typeof window.fetch`）、声明名、import/export 别名、模块级同名值绑定与非全局赋值解构目标；模块级绑定只按名字近似放行，嵌套作用域可能仍误判，`const w = window` 这类转存别名也可能漏报，也不追踪 `Reflect.get` 等间接提取。`window['loc' + 'alStorage']` 这类计算表达式与 `window.frames[0]` 等数值下标也不在静态检查范围。
- 页面端点检查覆盖 feature index 的直接 named re-export、`export *`、`export * as`、同文件 default/namespace/named `import ... from './api'` 的本地命名/默认/命名空间转发与字面量动态 import；经本地 const 或第二个模块再转发的端点不在静态检查范围内。命名空间/动态 import 的成员使用识别本文件内的属性访问、字面量下标、解构（含参数默认值、赋值解构与字面量计算键）、简单别名与 `.then` 回调（回调本身也可带 `as`/括号/非空/`satisfies` 包装），并解开 `as`/括号/非空/`satisfies` 包装；把命名空间整体传给其他函数、经对象字段/数组转存或重新赋值到未知来源时无法判定，可能漏报。别名按文件内同名合并，不做完整作用域解析，同名局部变量可能被误当作同一命名空间。
- 未写 `type` 的纯类型导入仍按运行时导入处理（例如 `import { ApiResponse } from '@/shared/api'` 用作类型）；需要跳过的类型依赖请使用 `import type` 或内联 `type` 说明符。
- API 模块的纯辅助导出（例如 `getItemIconUrl`）也会按来源被视为端点；当前页面未直接使用。若确需在页面直接使用纯函数，应由领域公开面提供非 `api/` 位置的导出或扩展白名单。
- `shared/` 的深路径没有统一公开面约定（`shared/components`、`shared/ui`、`shared/hooks` 等按目录使用），本检查只约束 feature 公开面。
- 测试文件被有意排除：它们可以 import 内部实现、使用 fetch 与计时器，且不会进入生产包。
- 布局锚点规则只核对五个固定文件中的 JSX 属性存在性；不验证锚点唯一、是否位于预期元素、是否在运行时可见，也不覆盖由页面工作区提供的其他 `data-region`。
- 全局样式规则只做选择器 prelude 的静态前缀匹配，不解析完整 CSS 语法：`#automation-*`、`[class*="automation-"]`、由其他属性拼出的页面选择器不会被识别，属性选择器值中出现前缀可能被误报；新增页面域时需要同步更新领域前缀集合。
- 布局测试规则基于 AST 成员的简单名称匹配：已覆盖 `toHaveStyle`、`toHaveBeenLastCalledWith` 与 `querySelector`/`querySelectorAll` 的字符串类选择器；未覆盖 `getComputedStyle`、动态属性访问、把类名或样式值经变量间接传入、`style` 对象整体断言，以及运行时拼接的选择器。`toHaveBeenCalledWith`/`toHaveBeenLastCalledWith` 只识别参数对象树中出现 `behavior` / `block` 键的调用。
