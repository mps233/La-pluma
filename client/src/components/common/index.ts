/**
 * 通用组件库
 * 提供可复用的 UI 组件，统一项目中的重复代码
 */

// 布局组件
export { default as PageHeader } from './PageHeader.tsx'
export { default as StatusIndicator } from './StatusIndicator.tsx'
export { Card, CardHeader, CardContent, InfoCard } from './Card.tsx'

// 表单组件
export { default as Button, IconButton } from './Button.tsx'
export { default as Input, Textarea, Select, Checkbox } from './Input.tsx'

// 反馈组件
export { default as Modal, ConfirmDialog } from './Modal.tsx'
export { default as Loading, FullScreenLoading, Skeleton, CardSkeleton } from './Loading.tsx'
