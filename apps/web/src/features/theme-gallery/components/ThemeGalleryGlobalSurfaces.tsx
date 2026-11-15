import { useState } from 'react'
import { Download, FileText, LoaderCircle, Plus, RefreshCw, Save, Square, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import Icons from '@/shared/components/Icons'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { EmptyState, Loading, PageSkeleton } from '@/shared/components'
import { ThemeGalleryCards } from './ThemeGalleryCards'
import { ThemeGalleryTooltips } from './ThemeGalleryTooltips'

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

const GALLERY_SOURCE_OPTIONS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: 'local', label: '本地目录' },
  { value: 'git', label: 'Git 仓库' },
  { value: 'mirrorchyan', label: 'MirrorChyan' },
  { value: 'offline', label: '离线镜像（禁用）', disabled: true },
]

const GALLERY_CHANNEL_OPTIONS = [
  { value: 'stable', label: '稳定版' },
  { value: 'beta', label: '测试版' },
  { value: 'alpha', label: '内测版' },
]

export function ThemeGalleryGlobalSurfaces() {
  const [address, setAddress] = useState('')
  const [checkInterval, setCheckInterval] = useState('600')
  const [source, setSource] = useState('git')
  const [autofill, setAutofill] = useState(true)
  const [sortRooms, setSortRooms] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)

  return (
    <>
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>状态与加载</CardTitle>
        </CardHeader>
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

      <div data-region="gallery-page-skeletons">
        <Card>
          <CardHeader className="border-b py-3.5">
            <CardTitle role="heading" aria-level={3}>整页骨架</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 overflow-hidden rounded-xl border border-border">
              <PageSkeleton variant="config" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>领域字形</CardTitle>
        </CardHeader>
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

      <ThemeGalleryCards />

      <div data-region="gallery-buttons" className="grid gap-4.5">
        <Card>
          <CardHeader className="border-b py-3.5">
            <CardTitle role="heading" aria-level={3}>按钮变体</CardTitle>
          </CardHeader>
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
          <CardHeader className="border-b py-3.5">
            <CardTitle role="heading" aria-level={3}>按钮状态与尺寸</CardTitle>
          </CardHeader>
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
          </CardContent>
        </Card>
      </div>

      <div data-region="gallery-form-controls">
        <Card>
          <CardHeader className="border-b py-3.5">
            <CardTitle role="heading" aria-level={3}>表单控件</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3.5 md:grid-cols-2">
            <div className="grid gap-3.5 md:col-span-2 md:grid-cols-2">
              <div>
                <label htmlFor="gallery-input-text" className="mb-2 block text-sm font-medium text-muted-foreground">连接地址</label>
                <Input
                  id="gallery-input-text"
                  type="text"
                  autoComplete="off"
                  value={address}
                  onChange={event => setAddress(event.target.value)}
                  placeholder="127.0.0.1:5555"
                />
                <p id="gallery-input-text-hint" className="mt-2 text-xs text-tertiary">ADB 设备连接地址。</p>
              </div>
              <div>
                <label htmlFor="gallery-input-number" className="mb-2 block text-sm font-medium text-muted-foreground">检查间隔（秒）</label>
                <Input
                  id="gallery-input-number"
                  type="number"
                  autoComplete="off"
                  min={0}
                  value={checkInterval}
                  onChange={event => setCheckInterval(event.target.value)}
                />
                <p className="mt-2 text-xs text-tertiary">0 表示禁用缓存。</p>
              </div>
              <div>
                <label htmlFor="gallery-input-disabled" className="mb-2 block text-sm font-medium text-muted-foreground">排班文件（禁用）</label>
                <Input
                  id="gallery-input-disabled"
                  type="text"
                  autoComplete="off"
                  value="schedules/base.json"
                  disabled
                  onChange={() => undefined}
                />
              </div>
              <div>
                <label htmlFor="gallery-input-error" className="mb-2 block text-sm font-medium text-muted-foreground">作业 URI</label>
                <Input
                  id="gallery-input-error"
                  type="text"
                  autoComplete="off"
                  aria-invalid
                  aria-describedby="gallery-input-error-message"
                  aria-errormessage="gallery-input-error-message"
                  value="maa://10086"
                  onChange={() => undefined}
                />
                <p id="gallery-input-error-message" role="alert" className="mt-2 text-xs form-error-text">未找到匹配的作业</p>
              </div>
            </div>
            <div>
              <label htmlFor="gallery-select-source" className="mb-2 block text-sm font-medium text-muted-foreground">资源来源</label>
              <Select
                items={GALLERY_SOURCE_OPTIONS}
                value={source}
                onValueChange={(next, details) => {
                  // Base UI 在受控值未注册到当前选项时以 reason 为 none 自动回退；写回会清空仍未渲染选项的值。
                  if (details.reason === 'none' || next === null) return
                  setSource(next)
                }}
              >
                <SelectTrigger id="gallery-select-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GALLERY_SOURCE_OPTIONS.map(item => (
                    <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-tertiary">本地目录、Git 仓库或 MirrorChyan。</p>
            </div>
            <div>
              <label htmlFor="gallery-select-disabled" className="mb-2 block text-sm font-medium text-muted-foreground">更新渠道（禁用）</label>
              <Select items={GALLERY_CHANNEL_OPTIONS} value="stable" onValueChange={() => undefined} disabled>
                <SelectTrigger id="gallery-select-disabled" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GALLERY_CHANNEL_OPTIONS.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={autofill} onCheckedChange={setAutofill} />
                <span className="transition-colors group-hover:text-primary">自动补位</span>
              </label>
              <label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={sortRooms} onCheckedChange={setSortRooms} />
                <span className="transition-colors group-hover:text-primary">按填写顺序排序</span>
              </label>
              <label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox indeterminate onCheckedChange={() => undefined} />
                <span>部分选择（混合态）</span>
              </label>
              <label className="group flex min-h-11 cursor-not-allowed items-center gap-2 text-sm text-muted-foreground opacity-50">
                <Checkbox checked disabled onCheckedChange={() => undefined} />
                <span>清除已保存的 CDK（禁用）</span>
              </label>
            </div>
            <div className="space-y-3">
              <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground">
                启用自动更新
                <Switch checked={autoUpdate} onCheckedChange={setAutoUpdate} aria-label="启用自动更新" />
              </label>
              <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground">
                定时执行（关闭）
                <Switch checked={false} onCheckedChange={() => undefined} aria-label="定时执行关闭" />
              </label>
              <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground">
                定时执行（禁用）
                <Switch checked disabled onCheckedChange={() => undefined} aria-label="定时执行禁用" size="sm" />
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      <ThemeGalleryTooltips />
    </>
  )
}
