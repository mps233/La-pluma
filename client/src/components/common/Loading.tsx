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
    violet: 'brand-text',
    emerald: 'brand-text',
    cyan: 'brand-text',
    orange: 'brand-text',
    fuchsia: 'brand-text',
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
        <p className="text-sm text-secondary">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-black/80">
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
      className={`surface-soft relative overflow-hidden ${variantStyles[variant]} ${className}`}
    >
      {/* Shimmer effect */}
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  )
}

/**
 * 卡片骨架屏
 */
export function CardSkeleton() {
  return (
    <div className="app-card app-stack-card surface-panel">
      <Skeleton variant="title" className="w-1/3" />
      <Skeleton variant="text" className="w-full" />
      <Skeleton variant="text" className="w-2/3" />
      <Skeleton variant="rect" className="w-full h-32" />
    </div>
  )
}

/**
 * Dashboard 骨架屏
 */
export function DashboardSkeleton() {
  return (
    <div className="app-page">
      <div className="mx-auto max-w-7xl app-stack-section">
        {/* PageHeader 骨架 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" className="w-10 h-10" />
            <div className="space-y-2">
              <Skeleton variant="title" className="w-24" />
              <Skeleton variant="text" className="w-40" />
            </div>
          </div>
          <Skeleton variant="rect" className="w-24 h-9 rounded-xl" />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
          {/* 左列 */}
          <div className="app-stack-section">
            {/* 博士信息卡片骨架 */}
            <div className="app-card surface-panel">
              <div className="mb-6 flex items-center gap-2 border-b border-[var(--app-border)] pb-3">
                <Skeleton variant="rect" className="w-1 h-6 rounded-full" />
                <Skeleton variant="title" className="w-20" />
              </div>
              <div className="grid gap-5 md:grid-cols-[auto_1fr]">
                {/* 头像骨架 */}
                <div className="flex-shrink-0 space-y-3">
                  <Skeleton variant="circle" className="w-24 h-24" />
                  <Skeleton variant="text" className="w-24 h-8" />
                </div>
                {/* 信息骨架 */}
                <div className="flex-1 space-y-4">
                  <Skeleton variant="title" className="w-32 h-8" />
                  <div className="flex gap-2">
                    <Skeleton variant="rect" className="w-28 h-6 rounded-lg" />
                    <Skeleton variant="rect" className="w-20 h-6 rounded-lg" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                    <Skeleton variant="rect" className="w-48 h-24 rounded-xl" />
                    <Skeleton variant="rect" className="w-32 h-24 rounded-xl" />
                  </div>
                </div>
              </div>
            </div>

            {/* 2x2 网格骨架 */}
            <div className="app-grid-section grid-cols-1 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="app-card app-stack-card surface-panel">
                  <div className="flex items-center gap-2">
                    <Skeleton variant="rect" className="w-1 h-5 rounded-full" />
                    <Skeleton variant="title" className="w-16" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton variant="rect" className="h-20 rounded-xl" />
                    <Skeleton variant="rect" className="h-20 rounded-xl" />
                    <Skeleton variant="rect" className="h-20 rounded-xl" />
                    <Skeleton variant="rect" className="h-20 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右列 */}
          <div className="app-stack-section">
            {/* 主线进度卡片骨架 */}
            <div className="app-card app-stack-card surface-panel">
              <div className="flex items-center gap-2 mb-4">
                <Skeleton variant="rect" className="w-1 h-6 rounded-full" />
                <Skeleton variant="title" className="w-20" />
              </div>
              <div className="text-center space-y-2">
                <Skeleton variant="title" className="w-20 h-10 mx-auto" />
                <Skeleton variant="text" className="w-24 h-4 mx-auto" />
              </div>
              <Skeleton variant="rect" className="h-2 rounded-full" />
              <Skeleton variant="rect" className="h-24 rounded-lg" />
            </div>

            {/* 基建详情卡片骨架 */}
            <div className="app-card app-stack-card surface-panel">
              <div className="flex items-center gap-2 mb-4">
                <Skeleton variant="rect" className="w-1 h-6 rounded-full" />
                <Skeleton variant="title" className="w-20" />
              </div>
              <div className="space-y-3">
                <Skeleton variant="text" className="w-16" />
                <Skeleton variant="rect" className="h-16 rounded-lg" />
                <Skeleton variant="rect" className="h-16 rounded-lg" />
                <Skeleton variant="text" className="w-16" />
                <Skeleton variant="rect" className="h-16 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
