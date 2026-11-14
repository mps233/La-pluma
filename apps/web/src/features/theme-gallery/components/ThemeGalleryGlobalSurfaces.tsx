import { useState } from 'react'
import { RefreshCw, Save, Trash2 } from 'lucide-react'
import Icons from '@/shared/components/Icons'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  IconButton,
  Input,
  Loading,
  PageSkeleton,
  SmoothPanel,
  Switch,
} from '@/shared/components'

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
        <CardHeader title="操作与输入" />
        <CardContent className="app-stack-card">
          <div className="flex flex-wrap items-center gap-3.5">
            <Button icon={<Save size={15} />}>保存草稿</Button>
            <Button variant="secondary">查看日志</Button>
            <Button variant="danger">停止执行</Button>
            <Button variant="success">重试</Button>
            <Button variant="ghost">忽略</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            <Button variant="secondary" size="sm">小尺寸</Button>
            <Button variant="secondary">中尺寸</Button>
            <Button variant="secondary" size="lg">大尺寸</Button>
            <Button variant="secondary" loading loadingText="执行中">开始执行</Button>
            <Button variant="ghost" disabled>不可用</Button>
            <IconButton icon={<RefreshCw size={16} />} title="刷新" />
            <IconButton variant="danger" icon={<Trash2 size={16} />} title="删除" />
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
