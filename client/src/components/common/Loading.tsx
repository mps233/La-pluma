import ActivityIndicator from './ActivityIndicator'

/**
 * 加载动画组件 Props
 */
interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

/**
 * 加载动画组件
 */
export default function Loading({
  size = 'md',
  text,
}: LoadingProps) {
  return (
    <div
      className="app-loading flex flex-col items-center justify-center space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <ActivityIndicator size={size} className="app-preloader" />

      {text && (
        <p className="text-sm text-secondary">
          {text}
        </p>
      )}
      {!text && <span className="sr-only">加载中</span>}
    </div>
  )
}
