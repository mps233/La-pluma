/**
 * 加载动画组件 Props
 */
export interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  color?: 'violet' | 'emerald' | 'cyan' | 'orange' | 'fuchsia'
  text?: string
}

/**
 * 全屏加载组件 Props
 */
export interface FullScreenLoadingProps {
  text?: string
}

/**
 * 骨架屏组件 Props
 */
export interface SkeletonProps {
  className?: string
  variant?: 'text' | 'title' | 'circle' | 'rect'
}

/**
 * 加载动画组件
 */
export default function Loading({
  size = 'md',
  color = 'violet',
  text,
}: LoadingProps) {
  const sizeStyles: Record<string, string> = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }
  
  const colorStyles: Record<string, string> = {
    violet: 'text-violet-500 dark:text-violet-400',
    emerald: 'text-emerald-500 dark:text-emerald-400',
    cyan: 'text-cyan-500 dark:text-cyan-400',
    orange: 'text-orange-500 dark:text-orange-400',
    fuchsia: 'text-fuchsia-500 dark:text-fuchsia-400',
  }
  
  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <svg
        className={`${sizeStyles[size]} ${colorStyles[color]} animate-spin`}
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      
      {text && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {text}
        </p>
      )}
    </div>
  )
}

/**
 * 全屏加载组件
 */
export function FullScreenLoading({ text = '加载中...' }: FullScreenLoadingProps) {
  return (
    <div className="fixed inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <Loading size="lg" text={text} />
    </div>
  )
}

/**
 * 骨架屏组件
 */
export function Skeleton({ className = '', variant = 'text' }: SkeletonProps) {
  const variantStyles: Record<string, string> = {
    text: 'h-4 rounded',
    title: 'h-6 rounded',
    circle: 'rounded-full',
    rect: 'rounded-xl',
  }
  
  return (
    <div
      className={`bg-gray-200 dark:bg-gray-800 animate-pulse ${variantStyles[variant]} ${className}`}
    />
  )
}

/**
 * 卡片骨架屏
 */
export function CardSkeleton() {
  return (
    <div className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60 space-y-4">
      <Skeleton variant="title" className="w-1/3" />
      <Skeleton variant="text" className="w-full" />
      <Skeleton variant="text" className="w-2/3" />
      <Skeleton variant="rect" className="w-full h-32" />
    </div>
  )
}
