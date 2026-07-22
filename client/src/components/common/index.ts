/**
 * 通用组件库
 * 提供可复用的 UI 组件，统一项目中的重复代码
 */

// 布局组件
export { default as PageHeader } from './PageHeader.tsx'
export { Card, CardHeader, CardContent, InfoCard } from './Card.tsx'
export { default as SmoothSurface } from './SmoothSurface.tsx'
export { default as SmoothPanel } from './SmoothPanel.tsx'

// 表单组件
export { default as Button, IconButton } from './Button.tsx'
export { default as Input, Select, Checkbox } from './Input.tsx'
export { default as Switch } from './Switch.tsx'

// 反馈组件
export { ConfirmDialog } from './Modal.tsx'
export { default as ActivityIndicator } from './ActivityIndicator.tsx'
export { default as Loading, PageSkeleton } from './Loading.tsx'
export { default as EmptyState } from './EmptyState.tsx'
