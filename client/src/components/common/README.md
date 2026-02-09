# 通用组件库

本目录包含项目中可复用的通用 UI 组件，用于统一代码风格和减少重复代码。

## 组件列表

### 1. PageHeader - 页面标题组件

统一的页面标题样式，包含图标、标题、副标题和操作区域。

**使用示例**：

```jsx
import { PageHeader } from '../components/common'
import Icons from './Icons'

// 基础用法
<PageHeader
  icon={<Icons.TargetIcon />}
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
  gradientFrom="emerald-400"
  gradientVia="green-400"
  gradientTo="teal-400"
/>

// 带操作按钮
<PageHeader
  icon={<Icons.CogIcon />}
  title="配置管理"
  subtitle="管理 MAA CLI 连接和运行配置"
  gradientFrom="orange-400"
  gradientVia="red-400"
  gradientTo="pink-400"
  actions={
    <StatusIndicator
      isActive={loading}
      activeText="处理中"
      inactiveText="就绪"
      activeColor="orange-400"
    />
  }
/>
```

**Props**：
- `icon` (ReactNode) - 图标组件
- `title` (string, required) - 主标题
- `subtitle` (string) - 副标题（可选）
- `gradientFrom` (string) - 渐变起始颜色（默认：violet-400）
- `gradientVia` (string) - 渐变中间颜色（默认：purple-400）
- `gradientTo` (string) - 渐变结束颜色（默认：fuchsia-400）
- `actions` (ReactNode) - 右侧操作区域（可选）
- `animated` (boolean) - 是否启用动画（默认：true）

**颜色预设**：
- 紫色系：`violet-400`, `purple-400`, `fuchsia-400`
- 绿色系：`emerald-400`, `green-400`, `teal-400`
- 蓝色系：`cyan-400`, `blue-400`, `indigo-400`
- 橙色系：`orange-400`, `red-400`, `pink-400`
- 黄色系：`amber-400`, `yellow-400`, `orange-400`

---

### 2. StatusIndicator - 状态指示器组件

统一的状态显示样式，包含动画圆点和状态文本。

**使用示例**：

```jsx
import { StatusIndicator } from '../components/common'

// 基础用法
<StatusIndicator
  isActive={isRunning}
  activeText="运行中"
  inactiveText="就绪"
/>

// 自定义颜色
<StatusIndicator
  isActive={loading}
  activeText="加载中"
  inactiveText="空闲"
  activeColor="orange-400"
  inactiveColor="emerald-400"
/>

// 自定义消息（优先级最高）
<StatusIndicator
  isActive={true}
  message={message || '等待任务'}
  activeColor="cyan-400"
/>
```

**Props**：
- `isActive` (boolean) - 是否处于活动状态（默认：false）
- `activeText` (string) - 活动状态文本（默认：运行中）
- `inactiveText` (string) - 非活动状态文本（默认：就绪）
- `activeColor` (string) - 活动状态颜色（默认：fuchsia-400）
- `inactiveColor` (string) - 非活动状态颜色（默认：emerald-400）
- `message` (string) - 自定义消息（优先级高于 activeText/inactiveText）

**颜色选项**：
- `fuchsia-400` - 紫红色（默认活动色）
- `emerald-400` - 翠绿色（默认非活动色）
- `orange-400` - 橙色
- `cyan-400` - 青色
- `purple-400` - 紫色
- `blue-400` - 蓝色

---

### 3. Card - 卡片组件

统一的卡片容器样式，支持动画和自定义样式。

**使用示例**：

```jsx
import { Card, CardHeader, CardContent, InfoCard } from '../components/common'

// 基础卡片
<Card>
  <h3>卡片标题</h3>
  <p>卡片内容</p>
</Card>

// 带动画和延迟
<Card animated delay={0.1}>
  <p>内容</p>
</Card>

// 带悬停效果
<Card hover>
  <p>鼠标悬停时会放大</p>
</Card>

// 带标题的卡片
<Card>
  <CardHeader
    icon={<Icons.Package />}
    title="材料掉落统计"
    actions={
      <button>刷新</button>
    }
  />
  <CardContent>
    <p>卡片内容区域</p>
  </CardContent>
</Card>

// 信息卡片（带颜色）
<InfoCard type="warning">
  <h3>使用说明</h3>
  <ul>
    <li>说明项 1</li>
    <li>说明项 2</li>
  </ul>
</InfoCard>
```

**Card Props**：
- `children` (ReactNode, required) - 卡片内容
- `className` (string) - 额外的 CSS 类名
- `animated` (boolean) - 是否启用动画（默认：true）
- `delay` (number) - 动画延迟（秒，默认：0）
- `hover` (boolean) - 是否启用悬停效果（默认：false）

**CardHeader Props**：
- `icon` (ReactNode) - 图标（可选）
- `title` (string, required) - 标题
- `actions` (ReactNode) - 右侧操作区域（可选）

**CardContent Props**：
- `children` (ReactNode, required) - 内容
- `className` (string) - 额外的 CSS 类名

**InfoCard Props**：
- `children` (ReactNode, required) - 内容
- `type` (string) - 类型：info, warning, error, success（默认：info）
- `className` (string) - 额外的 CSS 类名

---

## 重构建议

### 可以使用这些组件的地方

#### 1. 页面标题（所有页面）
**当前代码**：
```jsx
<motion.div className="flex items-center justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
  <div className="flex items-center space-x-3">
    <Icons.TargetIcon />
    <div>
      <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400 bg-clip-text text-transparent">
        自动战斗
      </h2>
      <p className="text-gray-600 dark:text-gray-500 text-sm hidden sm:block">配置自动刷关卡任务</p>
    </div>
  </div>
</motion.div>
```

**重构后**：
```jsx
<PageHeader
  icon={<Icons.TargetIcon />}
  title="自动战斗"
  subtitle="配置自动刷关卡任务"
  gradientFrom="emerald-400"
  gradientVia="green-400"
  gradientTo="teal-400"
/>
```

**减少代码量**：约 70%

---

#### 2. 状态指示器（所有页面）
**当前代码**：
```jsx
<div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-900/60 rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 border border-gray-200 dark:border-white/10 shadow-sm text-xs">
  <motion.div 
    className={`w-2 h-2 rounded-full flex-shrink-0 ${isRunning ? 'bg-fuchsia-400' : 'bg-emerald-400'}`}
    animate={{ 
      boxShadow: isRunning
        ? ['0 0 0 0 rgba(232, 121, 249, 0.7)', '0 0 0 4px rgba(232, 121, 249, 0)', '0 0 0 0 rgba(232, 121, 249, 0)']
        : ['0 0 0 0 rgba(52, 211, 153, 0.7)', '0 0 0 4px rgba(52, 211, 153, 0)', '0 0 0 0 rgba(52, 211, 153, 0)']
    }}
    transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
  />
  <div className="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">
    {isRunning ? (message || '运行中') : (message || '就绪')}
  </div>
</div>
```

**重构后**：
```jsx
<StatusIndicator
  isActive={isRunning}
  message={message}
  activeText="运行中"
  inactiveText="就绪"
/>
```

**减少代码量**：约 85%

---

#### 3. 卡片容器（所有页面）
**当前代码**：
```jsx
<motion.div 
  className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.1 }}
>
  <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
    <h3 className="text-lg font-bold text-gray-900 dark:text-white">标题</h3>
  </div>
  <div className="p-6">
    内容
  </div>
</motion.div>
```

**重构后**：
```jsx
<Card animated delay={0.1}>
  <CardHeader title="标题" />
  <CardContent>
    内容
  </CardContent>
</Card>
```

**减少代码量**：约 75%

---

## 重构优先级

### 高优先级（建议立即重构）
1. **CombatTasks.jsx** - 页面标题 + 状态指示器
2. **RoguelikeTasks.jsx** - 页面标题 + 状态指示器
3. **ConfigManager.jsx** - 页面标题 + 状态指示器 + 多个卡片
4. **DataStatistics.jsx** - 页面标题 + 状态指示器
5. **OperatorTraining.jsx** - 页面标题 + 状态指示器
6. **AutomationTasks.jsx** - 页面标题 + 状态指示器

### 中优先级
7. **LogViewer.jsx** - 页面标题 + 卡片
8. **ScreenMonitor.jsx** - 卡片

### 预期收益
- **代码减少**：约 500-800 行
- **可维护性提升**：统一的组件修改一处即可全局生效
- **一致性提升**：所有页面使用相同的视觉风格
- **开发效率提升**：新页面开发速度提升 50%+

---

## 注意事项

### Tailwind CSS 动态类名问题

⚠️ **重要**：Tailwind CSS 不支持动态拼接类名！

**错误示例**：
```jsx
// ❌ 这样不会生效！
className={`bg-${color}`}
className={`from-${gradientFrom}`}
```

**解决方案**：

1. **使用完整的类名映射**（推荐）：
```jsx
const colorMap = {
  'violet-400': 'bg-violet-400',
  'purple-400': 'bg-purple-400',
  // ...
}
className={colorMap[color]}
```

2. **使用 safelist 配置**（在 tailwind.config.js 中）：
```js
module.exports = {
  safelist: [
    'bg-violet-400',
    'bg-purple-400',
    'from-emerald-400',
    // ... 列出所有可能用到的类名
  ]
}
```

3. **使用内联样式**（不推荐，失去 Tailwind 优势）：
```jsx
style={{ backgroundColor: color }}
```

**当前实现**：PageHeader 和 StatusIndicator 组件已经使用了完整类名映射的方式，可以安全使用。

---

## 下一步计划

1. ✅ 创建通用组件（已完成）
2. ⏳ 重构现有组件使用通用组件
3. ⏳ 添加更多通用组件（Button, Input, Modal 等）
4. ⏳ 编写组件单元测试

---

**创建时间**: 2026-02-09  
**维护者**: @mps233
