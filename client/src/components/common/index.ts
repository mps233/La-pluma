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

// 反馈组件
export { Modal, ConfirmDialog } from './Modal.tsx'
export { default as Loading, PageSkeleton } from './Loading.tsx'
export { default as EmptyState } from './EmptyState.tsx'
export { default as Tooltip } from './Tooltip.tsx'
export { default as StatusMark } from './StatusMark.tsx'
