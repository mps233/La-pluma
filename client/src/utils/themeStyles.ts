/**
 * 主题样式工具函数
 * 提供统一的 Tailwind CSS 类名组合，支持深色/浅色主题
 */

// 卡片样式
export const cardBg: string = 'bg-white dark:bg-[rgba(15,15,15,0.6)]'
export const cardBorder: string = 'border-gray-200 dark:border-white/10'
export const cardBgSolid: string = 'bg-gray-50 dark:bg-[rgba(20,20,20,0.6)]'

// 文本样式
export const textPrimary: string = 'text-gray-900 dark:text-white'
export const textSecondary: string = 'text-gray-600 dark:text-gray-400'
export const textTertiary: string = 'text-gray-500 dark:text-gray-500'

// 输入和按钮样式
export const inputBg: string = 'bg-white dark:bg-[#070707]'
export const buttonBg: string = 'bg-gray-100 dark:bg-white/5'
export const buttonHover: string = 'hover:bg-gray-200 dark:hover:bg-white/10'

// 组合样式
export const card: string = `${cardBg} ${cardBorder}`
export const text: string = textPrimary
export const textMuted: string = textSecondary
