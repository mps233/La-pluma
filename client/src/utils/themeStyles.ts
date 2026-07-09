/**
 * 主题样式工具函数
 * 提供统一的 Tailwind CSS 类名组合，支持深色/浅色主题
 */

// 卡片样式
export const cardBg: string = 'surface-panel'
export const cardBorder: string = ''
export const cardBgSolid: string = 'surface-soft'
export const cardSurface: string = 'app-card surface-panel'
export const cardSoft: string = 'app-card surface-soft'
export const stackCard: string = 'app-stack-card'
export const stackSection: string = 'app-stack-section'
export const gridCard: string = 'app-grid-card'

// 文本样式
export const textPrimary: string = 'text-primary'
export const textSecondary: string = 'text-secondary'
export const textTertiary: string = 'text-tertiary'

// 输入和按钮样式
export const inputBg: string = 'control-surface'
export const buttonBg: string = 'control-surface'
export const buttonHover: string = ''
export const inputControl: string = 'app-input control-surface'
export const buttonControl: string = 'app-button control-surface'

// 品牌强调与状态
export const brandAction: string = 'brand-action'
export const brandSubtle: string = 'brand-action-subtle'
export const statusSuccess: string = 'status-success'
export const statusWarning: string = 'status-warning'
export const statusDanger: string = 'status-danger'
export const statusInfo: string = 'status-info'

// 组合样式
export const card: string = `${cardBg} ${cardBorder}`
export const panel: string = cardSurface
export const text: string = textPrimary
export const textMuted: string = textSecondary
