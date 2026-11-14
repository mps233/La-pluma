import { useState } from 'react'
import { Download, FileText, LoaderCircle, Plus, RefreshCw, Save, Square, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import Icons from '@/shared/components/Icons'
import {
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Input,
  Loading,
  PageSkeleton,
  SmoothPanel,
  Switch,
} from '@/shared/components'

const buttonVariants: Array<{ variant: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link', label: string, icon: LucideIcon }> = [
  { variant: 'default', label: '保存草稿', icon: Save },
  { variant: 'secondary', label: '查看日志', icon: RefreshCw },
  { variant: 'outline', label: '导出数据', icon: Download },
  { variant: 'ghost', label: '忽略', icon: Square },
  { variant: 'destructive', label: '停止执行', icon: Trash2 },
  { variant: 'link', label: '查看文档', icon: FileText },
]

const buttonSizes: Array<{ size: 'xs' | 'sm' | 'default' | 'lg', label: string }> = [
  { size: 'xs', label: '超小' },
  { size: 'sm', label: '小尺寸' },
  { size: 'default', label: '中尺寸' },
  { size: 'lg', label: '大尺寸' },
]

const iconButtonSizes: Array<{ size: 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg', label: string }> = [
  { size: 'icon-xs', label: '图标 超小' },
  { size: 'icon-sm', label: '图标 小尺寸' },
  { size: 'icon', label: '图标 中尺寸' },
  { size: 'icon-lg', label: '图标 大尺寸' },
]

export function ThemeGalleryGlobalSurfaces() {
  const [address, setAddress] = useState('')
  const [jobUri, setJobUri] = useState('maa://10086')
  const [scheduled, setScheduled] = useState(false)

  return (
    <>
      <Card>
        <CardHeader title="状态与加载" />
        <CardContent className="grid gap-3.5 md:grid-cols-2">
          <Loading text="正在读取运行数据" />
          <EmptyState
            compact
            icon={<Icons.TrendingUp />}
            title="暂无掉落记录"
            description="执行作战并完成材料识别后，会在这里汇总掉落。"
            action={<Button variant="secondary">刷新</Button>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="整页骨架" />
        <CardContent>
          <div className="h-72 overflow-hidden rounded-xl border border-border">
            <PageSkeleton variant="config" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="领域字形" />
        <CardContent className="app-stack-card">
          <div className="flex flex-wrap items-center gap-3.5">
            <Icons.Play />
            <Icons.Sword />
            <Icons.Gift />
            <Icons.Stop />
            <Icons.Package />
            <Icons.Shield />
            <Icons.Document />
            <Icons.Target />
          </div>
          <div className="flex items-center gap-3.5 text-muted-foreground">
            <Icons.TrendingUp />
            <Icons.Zap />
            <Icons.Star />
            <Icons.RefreshCw />
            <Icons.Crosshair />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="面板容器" />
        <CardContent className="grid gap-3.5 md:grid-cols-3">
          <Card>
            <p className="text-sm text-muted-foreground">基础卡片，外层负责阴影与边框。</p>
          </Card>
          <Card smoothCorners>
            <p className="text-sm text-muted-foreground">连续圆角卡片，内部表面负责裁切。</p>
          </Card>
          <SmoothPanel surfaceClassName="flex items-center px-4 py-4">
            <p className="text-sm text-muted-foreground">连续圆角独立面板。</p>
          </SmoothPanel>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="按钮变体" />
        <CardContent className="app-stack-card">
          <div className="flex flex-wrap items-center gap-3.5">
            {buttonVariants.map(({ variant, label, icon }) => {
              const VariantIcon = icon
              return (
                <Button key={variant} variant={variant}>
                  <VariantIcon size={16} aria-hidden="true" />
                  {label}
                </Button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            {buttonVariants.map(({ variant, label }) => (
              <Button key={variant} variant={variant}>{label}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="按钮状态与尺寸" />
        <CardContent className="app-stack-card">
          <div className="flex flex-wrap items-center gap-3.5">
            {buttonSizes.map(({ size, label }) => (
              <Button key={size} variant="secondary" size={size}>{label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            <Button><LoaderCircle className="animate-spin" aria-hidden="true" />执行中</Button>
            <Button variant="secondary" disabled><LoaderCircle className="animate-spin" aria-hidden="true" />同步中</Button>
            <Button variant="ghost" disabled>不可用</Button>
            <Button variant="destructive" disabled>已停止</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            {iconButtonSizes.map(({ size, label }) => (
              <Button key={size} size={size} variant="secondary" title={label} aria-label={label}>
                <Plus aria-hidden="true" />
              </Button>
            ))}
            <Button size="icon" variant="ghost" title="刷新" aria-label="刷新">
              <RefreshCw size={16} aria-hidden="true" />
            </Button>
            <Button size="icon" variant="destructive" title="删除" aria-label="删除">
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-3.5 md:grid-cols-2">
            <Input
              label="连接地址"
              value={address}
              onChange={setAddress}
              placeholder="127.0.0.1:5555"
              hint="ADB 设备连接地址。"
            />
            <Input
              label="作业 URI"
              value={jobUri}
              onChange={setJobUri}
              error="未找到匹配的作业"
            />
          </div>
          <Switch label="启用定时执行" checked={scheduled} onChange={setScheduled} />
        </CardContent>
      </Card>
    </>
  )
}
