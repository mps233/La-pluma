/**
 * 通用组件库
 * 提供可复用的 UI 组件，统一项目中的重复代码
 */

// 布局组件
export { default as PageHeader } from './PageHeader.tsx'
export { Card, CardHeader, CardContent } from './Card.tsx'
export { default as SmoothPanel } from './SmoothPanel.tsx'
export { default as CjkText } from './CjkText.tsx'
export { default as TruncatedText } from './TruncatedText.tsx'
export { default as SwipeModePager } from './SwipeModePager.tsx'

// 表单组件
export { default as Button, IconButton } from './Button.tsx'
export { default as Input, Select, Checkbox } from './Input.tsx'
export { default as Switch } from './Switch.tsx'
// Glass form fields pull the select/popup kit. Import them from './fields'
// directly so the entry barrel does not carry the popup foundation.

// 反馈组件
// Modal stays out of this barrel: it carries the animation library and every
// current consumer is a lazy page or dialog. Import it from './Modal' directly.
export { default as Loading } from './Loading.tsx'
export { default as EmptyState } from './EmptyState.tsx'
// StatusMark is combat-only; importing it from here would pull its animation
// library into every chunk that uses this barrel.
export { default as ActivityIndicator } from './ActivityIndicator.tsx'
export { default as Tooltip } from './Tooltip.tsx'
export { GlassLiveCardButton } from './GlassLiveCardButton.tsx'
