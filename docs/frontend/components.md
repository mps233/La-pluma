# 通用组件库

> [← 返回文档索引](../README.md)
>
> 视觉与交互规则以根目录 [设计规范](../../DESIGN.md) 为唯一来源；本文件只记录组件 API、用法与页面落地清单。

## 概述

为了减少重复代码、统一视觉风格、提升开发效率，项目维护一套通用 UI 组件。shadcn CLI 生成的上游原语位于 `apps/web/src/shared/ui/`，随上游原样保留；`Button`、`Input`、`Select`、`Checkbox`、`Switch`、`Card` 等控件直接从对应的 `@/shared/ui/*` 模块导入。应用层组合组件位于 `apps/web/src/shared/components/*.tsx`，通过 `apps/web/src/shared/components/index.ts` 统一导出，页面从 `@/shared/components` 引入。本文件记录生成原语的组合用法与必须遵循的应用层约定。

加载占位直接使用 `@/shared/ui/skeleton` 的 `Skeleton`，不要在应用层重写 shimmer 或另建骨架原语。

新增或调整组件时，在本文件补充 API 与用法；颜色、字号、间距、圆角、交互状态等规则不要在组件文档里另写一份。

---

## 组件列表

### PageHeader - 页面标题组件

**文件位置**：`apps/web/src/shared/components/PageHeader.tsx`

**适用场景**：所有页面的顶部标题区域。

```typescript
{
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  mobileLayout?: 'stack' | 'inline'
}
```

```tsx
import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'

<PageHeader
  title="自动战斗"
  mobileLayout="inline"
  actions={<FloatingStatusIndicator />}
/>
```

页面标题统一使用全局品牌色，不再支持页面单独传入渐变色。一级工作区标题不使用 `icon-well`，只有确有身份识别需要的独立页面才传入 `icon`。手机端默认使用 `stack` 保护长标题和多操作；控制台及同级 `ios-workspace-page` 使用 `mobileLayout="inline"`，由右侧状态浮条主动收缩。

`subtitle` 可选，只在需要补充标题与布局无法表达的信息时传入，不用来复述页面用途或铺陈说明。

---

### Card - 卡片组件

**文件位置**：`apps/web/src/shared/ui/card.tsx`（shadcn 生成物，随上游原文保留）

**适用场景**：卡片、信息区块、带标题的内容区域与独立工作区面板。

```tsx
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'

<Card>
  <CardHeader>
    <CardTitle role="heading" aria-level={3}>材料掉落统计</CardTitle>
    <CardDescription>最近一次作战的掉落汇总。</CardDescription>
    <CardAction><Button size="sm">刷新</Button></CardAction>
  </CardHeader>
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
  <CardFooter>
    <p>页脚说明</p>
  </CardFooter>
</Card>

<Card className="roguelike-theme-panel gap-0 p-0!">
  <div className="border-b border-border px-4 py-3.5">分节标题</div>
  <div className="px-4 py-4">自管理内边距的面板内容</div>
</Card>
```

`Card` 使用 shadcn 语义 token（`bg-card`、`ring-foreground/10`、`--card-spacing`）与普通圆角；标题、描述、操作分别使用 `CardTitle`、`CardDescription`、`CardAction`，页脚使用 `CardFooter`。需要分节面板且各分节自持内边距时，给 `Card` 加 `gap-0 p-0!`，不再引入独立面板包装组件。标题需要保留文档层级时，在 `CardTitle` 上使用 `role="heading"` 与 `aria-level`。紧凑提示容器使用语义类 `app-info-card` 配合对应状态类；`surface-panel` 继续用于主题菜单与 PWA 提示等应用自绘召唤层，不用于 `Card` 或 shadcn 生成弹层。

控制台同类功能页在根节点添加 `ios-workspace-page`，并显式给 `PageHeader` 传 `mobileLayout="inline"`。卡片材质统一由 shadcn 语义 token 控制，不要在页面级另造卡片材质。

---

### Button

**文件位置**：`apps/web/src/shared/ui/button.tsx`（shadcn 生成物，随上游原文保留）

**适用场景**：文本按钮、主要操作、危险操作与图标按钮。

```tsx
import { Button } from '@/shared/ui/button'
import { LoaderCircle, RefreshCw, Save } from 'lucide-react'

<Button><Save aria-hidden="true" />保存</Button>
<Button variant="destructive" disabled={deleting} aria-busy={deleting || undefined}>
  {deleting ? <><LoaderCircle className="animate-spin" aria-hidden="true" />删除中</> : '删除'}
</Button>
<Button variant="ghost" size="icon" title="刷新" aria-label="刷新">
  <RefreshCw aria-hidden="true" />
</Button>
```

`Button` 的 `variant` 为 `default`、`secondary`、`outline`、`ghost`、`destructive`、`link`；`size` 为 `xs`、`sm`、`default`、`lg`、`icon-xs`、`icon-sm`、`icon`、`icon-lg`。新增按钮优先使用这些档位，不要在页面里手写一套按钮颜色、阴影和圆角。

图标作为按钮的 children 直接渲染，并添加 `aria-hidden="true"`；图标尺寸由生成组件的内建规则处理，不要在调用处传旧的 `icon` prop 或覆盖图标与文字间距。无文字操作使用 `size="icon"` 档位，调用时必须同时提供 `title` 和 `aria-label`。

loading 不是 `Button` 的 prop：调用点用 `disabled` 阻止重复提交，加 `aria-busy`，并用 `LoaderCircle` 与进行中文案替换原内容；不存在 `loadingText`。同一操作不要叠加第二个旋转图标。

---

### Input / Select / Checkbox / Switch

**文件位置**：`apps/web/src/shared/ui/input.tsx`、`apps/web/src/shared/ui/select.tsx`、`apps/web/src/shared/ui/checkbox.tsx`、`apps/web/src/shared/ui/switch.tsx`（均为 shadcn 生成物）

**适用场景**：表单输入、选择、错误提示、说明文字与二元设置。

```tsx
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/checkbox'
import { Switch } from '@/shared/ui/switch'

<div>
  <label htmlFor="adb-path" className="mb-2 block text-sm font-medium text-muted-foreground">ADB 路径</label>
  <Input
    id="adb-path"
    autoComplete="off"
    aria-invalid={Boolean(adbPathError)}
    aria-errormessage={adbPathError ? 'adb-path-error' : undefined}
  />
  {adbPathError && <p id="adb-path-error" role="alert" className="form-error-text">{adbPathError}</p>}
</div>

<Select items={strategyOptions} value={strategy} onValueChange={setStrategy}>
  <SelectTrigger id="strategy" className="w-full"><SelectValue /></SelectTrigger>
  <SelectContent>
    {strategyOptions.map(item => (
      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
    ))}
  </SelectContent>
</Select>

<label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
  <Checkbox checked={continueOnFailure} onCheckedChange={setContinueOnFailure} />
  <span className="transition-colors group-hover:text-primary">失败后继续下一个</span>
</label>

<label className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground">
  启用定时执行
  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label="启用定时执行" />
</label>
```

`Input`、`Select`、`Checkbox`、`Switch` 直接导入 `@/shared/ui/*`，原语不提供 `label`、`error`、`hint` 或 `hintPlacement` props。字段行由各 feature 的 field helper 组合标签、控件与错误态；说明提示使用下方 `FieldHint`，不要给原语另加说明参数。多行文本使用原生 `textarea`。

错误态给控件传 `aria-invalid`，需要与错误文本建立关联时再传 `aria-errormessage`；错误文本使用 `form-error-text`，不要在页面里单独手写红色边框。`Select` 由 Root、`SelectTrigger`、`SelectValue`、`SelectContent` 与 `SelectItem` 组合，受控值通过 `value` / `onValueChange` 传递；选项数组传给 Root 的 `items`，`SelectValue` 才能显示当前标签。

`autoComplete="off"` 是消费点（feature field helper 或直接调用处）的契约，不是 `@/shared/ui/input` 原语的默认值。配置值与搜索词在新增输入时显式关闭浏览器自动填充历史，确实需要浏览器记住输入时才改为显式传入其他值。

---

### FieldHint - 标签说明提示

**文件位置**：`apps/web/src/shared/components/FieldHint.tsx`

**适用场景**：字段说明需要从控件下方的常驻段落收敛为标签旁的 ⓘ 提示。通过 `@/shared/components` 导入，不要在页面里重复拼装触发器。

```tsx
import { FieldHint } from '@/shared/components'

<FieldHint id="field-hint" label="难度" hint="不切换时沿用游戏内当前难度。" />
```

组件在打开时才挂载提示内容，内容带 `role="tooltip"`，触发器的 `aria-describedby` 仅在打开时指向内容 id；触发器保留 `${label}说明` 的 `aria-label`，并同时支持悬停、聚焦、点击与触屏点按。粗指针设备忽略 Base UI 合成的 hover 开关，提示由点按、点击或聚焦打开，直到 Escape、外部点按或 blur 关闭。提示内容只承载文本，使用 `pointer-events-none`，根节点设置 `disableHoverablePopup`，避免覆盖相邻控件时吞掉悬停或点击。

自定义触发器时，用 `@/shared/ui/tooltip` 组合 `Tooltip`、`TooltipTrigger`（通过 `render` 承载按钮）与 `TooltipContent`，并保持上述受控 `open`、点击/触屏打开、`role`/`aria-describedby` 与非遮挡约定。

---

### EmptyState

**文件位置**：`apps/web/src/shared/components/EmptyState.tsx`

**适用场景**：流程、列表、统计区或数据面板暂时没有内容。通过 `@/shared/components` 导入，不要在页面中各自拼装“暂无数据”的图标、文案和间距。

```tsx
import { EmptyState } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import Icons from '@/shared/components/Icons'

<EmptyState
  compact
  icon={<Icons.TrendingUp />}
  title="暂无掉落记录"
  description="执行作战并完成材料识别后，会在这里汇总掉落。"
  action={<Button variant="secondary">刷新</Button>}
/>
```

Props：

- `icon` (ReactNode) - 可选图标。
- `title` (ReactNode, required) - 空状态主文案。
- `description` (ReactNode) - 补充说明。
- `action` (ReactNode) - 可选操作，如刷新或新建。
- `compact` (boolean) - 用于卡片内部的紧凑布局，默认 `false`。
- `className` (string) - 仅在页面结构需要额外布局约束时使用。

卡片内部使用 `compact`，页面级空状态保留默认尺寸。已有自动化流程和掉落记录页使用该组件。

---

### ConfirmAlertDialog / Loading

**文件位置**：`apps/web/src/shared/components/ConfirmAlertDialog.tsx`、`apps/web/src/shared/components/Loading.tsx`

**适用场景**：需要确认的破坏性操作使用 `ConfirmAlertDialog`；短时局部等待使用 `Loading`。两者都由 `shared/components` 的 `index.ts` 导出。

```tsx
import { ConfirmAlertDialog, Loading } from '@/shared/components'

{loading ? <Loading text="正在读取日志..." /> : content}
<ConfirmAlertDialog
  isOpen={confirmOpen}
  onClose={() => setConfirmOpen(false)}
  onConfirm={handleDelete}
  title="确认删除"
  message="此操作不可撤销。"
/>
```

`ConfirmAlertDialog.onConfirm` 可以返回 Promise：返回 `false` 或抛出错误时弹窗保持打开，并在弹窗内展示失败原因；确认处理中会禁用取消与确认按钮并阻止 Escape 关闭。组件内部组合 `shared/ui/alert-dialog`，初始焦点落在取消按钮。

页面级对话框、抽屉与确认框直接组合 `@/shared/ui` 的生成原语，不经过应用层包装：

- `Dialog` 用于表单、选择器与发现弹窗；内容区滚动、页头与页脚由调用点用 `DialogHeader`、`DialogTitle`、`DialogDescription`、`DialogFooter` 组合。
- `Sheet` 用于作业详情抽屉：桌面 `side="right"`、移动 `side="bottom"`；需要保留页面可交互时使用 Root 的 `modal={false}` 并自行处理外部点击关闭。
- `AlertDialog` 用于必须显式确认的操作；`role="alertdialog"` 由原语提供。
- 嵌套弹层按 React 父子关系组合（如发现弹窗内的筛选弹窗、详情抽屉上的重置确认框），Base UI 依此管理 Escape 层级、焦点归还与滚动锁。

`DashboardSkeleton` 是控制台域专用骨架，位于 `features/dashboard/components/DashboardSkeleton.tsx`，不属于 `shared/components` 的公共导出。

---

### UndoToastCard / AppToaster

**文件位置**：`apps/web/src/shared/components/UndoToastCard.tsx`、`apps/web/src/shared/components/AppToaster.tsx`

**适用场景**：需要「已移除 + 撤销」语义的应用级提示。`AppToaster` 在应用根挂载一次，主题跟随 `useTheme` 的解析明暗与 `lpn-ui`；提示固定在底部居中，桌面停留 24px，窄屏抬高以避开 tab bar 与安全区。`UndoToastCard` 是提示内容，默认 8 秒后自动关闭，悬停或键盘聚焦时暂停，`pending` 时禁用撤销与关闭并显示恢复中；宽度按内容收缩并居中，窄屏上限为 `calc(100vw - 2rem)`，播报由 sonner 外层 live region 承担。

```tsx
import { toast } from 'sonner'
import { AppToaster, UndoToastCard } from '@/shared/components'

// 应用根：<AppToaster />

toast.custom(() => (
  <UndoToastCard
    message="已移除 阿米娅"
    pending={false}
    onUndo={handleUndo}
    onDismiss={handleDismiss}
  />
), { id: 'undo-toast', duration: Infinity, dismissible: false })
```

使用 `toast.custom` 时让卡片自己管理 8 秒计时与暂停，因此传入 `duration: Infinity`；关闭按钮与撤销动作由卡片提供，因此传入 `dismissible: false`。同一提示复用稳定 id，避免重复堆叠。

---

### PageSkeleton

**文件位置**：`apps/web/src/shared/components/Loading.tsx`，与 `Loading` 同文件导出。

**适用场景**：懒加载路由的整页骨架占位。按 `variant` 复刻目标工作区的布局比例，减少加载完成后的跳动。

Props：

- `variant` (string, required) - 目标页面标识。内置 `automation`、`combat`、`roguelike`、`training`、`logs`、`statistics`、`config` 七种工作区骨架，其余取值只渲染页头骨架。

```tsx
import { PageSkeleton } from '@/shared/components'

<PageSkeleton variant="automation" />
```

输出为 `aria-busy="true"`、`aria-label="页面内容加载中"` 的忙碌区域，内部骨架标记 `aria-hidden="true"`；根节点携带目标页面的页面级类名（`app-page`、`ios-workspace-page` 及各页专属类）。控制台骨架由域内 `DashboardSkeleton` 提供，见上文。

---

### Icons

**文件位置**：`apps/web/src/shared/components/Icons.tsx`

**适用场景**：业务身份与概览图标。组件以默认对象导出，页面从 `@/shared/components/Icons` 导入后按名称使用；普通功能图标优先使用 `lucide-react`，不要在页面重复手写 SVG。

```tsx
import Icons from '@/shared/components/Icons'

<Icons.TrendingUp />
```

业务身份图标（Play、Sword、Gift 等）自带 `icon-well` 身份底座，只用于页面、概览和卡片的内容身份，不能包裹普通按钮图标；`TrendingUp`、`Zap`、`Star`、`RefreshCw`、`Crosshair` 等概览/内联图标是裸 SVG。装饰图标加 `aria-hidden="true"`；状态与结果同时提供可读文字或 `aria-label`。

---

### useFluidTabIndicator

**文件位置**：`apps/web/src/shared/hooks/useFluidTabIndicator.ts`

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

## 组件接入

新增页面或改老页面时，按下面顺序处理：

1. 页面外层使用 `app-page`，主内容使用 `app-stack-section`。
2. 页面标题使用 `PageHeader`。
3. 大面板使用 `Card` 组合；分节自持内边距时给 `Card` 加 `gap-0 p-0!`。
4. 表单使用 `@/shared/ui` 的 `Input`、`Select`、`Checkbox`、`Switch` 原语，并用所属 feature 的 field helper 组合标签与错误；多行文本使用原生 `textarea`。
5. 没有内容时使用 `EmptyState`，不要重复手写空状态。
6. 动态分段标签优先使用 `useFluidTabIndicator`，不要复制测量逻辑。
7. 页面全局执行状态使用 `FloatingStatusIndicator`；局部状态使用既有 `status-*` 语义类并紧邻相关操作。
8. 操作用 `@/shared/ui/button` 的 `Button`；无文字操作使用 `size="icon"` 档位并同时提供 `title` 与 `aria-label`。
9. 如果出现新的颜色、圆角、间距需求，先按根目录 [设计规范](../../DESIGN.md) 判断是否应抽成 token 或语义类。

### Tailwind 动态类名

Tailwind CSS 不支持动态拼接类名：

```tsx
// 不要这样写
className={`bg-${color}`}
className={`from-${tone}`}
```

需要按状态切换样式时，使用明确的 class 映射，或优先使用已有语义类。
