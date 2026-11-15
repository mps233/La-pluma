import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'

const GALLERY_ORDER_OPTIONS = [
  { value: 'hot', label: '热度优先' },
  { value: 'latest', label: '最新上传' },
  { value: 'views', label: '浏览最多' },
]

export function ThemeGalleryDialogs() {
  const [standardOpen, setStandardOpen] = useState(false)
  const [order, setOrder] = useState('hot')
  const [largeOpen, setLargeOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [nestedAlertOpen, setNestedAlertOpen] = useState(false)
  const [nestedSheetOpen, setNestedSheetOpen] = useState(false)
  const [rightSheetOpen, setRightSheetOpen] = useState(false)
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false)
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false)

  return (
    <div data-region="gallery-dialogs">
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>对话框与抽屉</CardTitle>
          <CardDescription>Dialog、AlertDialog 与 Sheet 的打开态组合；触发按钮与弹层分别截图。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setStandardOpen(true)}>打开标准对话框</Button>
          <Button variant="secondary" onClick={() => setLargeOpen(true)}>打开大尺寸对话框</Button>
          <Button variant="destructive" onClick={() => setAlertOpen(true)}>打开确认对话框</Button>
          <Button variant="secondary" onClick={() => setRightSheetOpen(true)}>打开右侧抽屉</Button>
          <Button variant="secondary" onClick={() => setBottomSheetOpen(true)}>打开底部抽屉</Button>
        </CardContent>
      </Card>

      <Dialog open={standardOpen} onOpenChange={setStandardOpen}>
        <DialogContent id="gallery-dialog-standard" aria-modal="true">
          <DialogHeader>
            <DialogTitle>同步执行记录</DialogTitle>
            <DialogDescription>
              标准尺寸对话框使用 shadcn 的标题、描述与页脚组合，关闭按钮由原语提供。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            内容区保持普通文档流；对话框会接管焦点并在关闭后归还给触发按钮。
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">排序方式</span>
            <Select
              items={GALLERY_ORDER_OPTIONS}
              value={order}
              onValueChange={(next, details) => {
                if (details.reason === 'none' || next === null) return
                setOrder(next)
              }}
            >
              <SelectTrigger id="gallery-dialog-order" aria-label="画廊排序" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GALLERY_ORDER_OPTIONS.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNestedAlertOpen(true)}>在对话框上打开确认框</Button>
            <Button variant="secondary" onClick={() => setNestedSheetOpen(true)}>在对话框上打开抽屉</Button>
            <Button id="gallery-standard-done" onClick={() => setStandardOpen(false)}>完成</Button>
          </DialogFooter>
          <Sheet open={nestedSheetOpen} onOpenChange={setNestedSheetOpen}>
            <SheetContent id="gallery-nested-sheet" side="right" aria-modal="true">
              <SheetHeader>
                <SheetTitle>筛选条件</SheetTitle>
                <SheetDescription>抽屉叠在对话框之上，关闭后回到对话框。</SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <Button onClick={() => setNestedSheetOpen(false)}>完成</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          <AlertDialog open={nestedAlertOpen} onOpenChange={setNestedAlertOpen}>
            <AlertDialogContent id="gallery-nested-alert-dialog" aria-modal="true">
              <AlertDialogHeader>
                <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
                <AlertDialogDescription>关闭确认框后仍停留在下方对话框。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>保留更改</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => setNestedAlertOpen(false)}>
                  放弃更改
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>

      <Dialog open={largeOpen} onOpenChange={setLargeOpen}>
        <DialogContent id="gallery-dialog-large" aria-modal="true" className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>批量导入作业</DialogTitle>
            <DialogDescription>大尺寸对话框用于表格、筛选器与长内容。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {['作业文件', '关卡范围', '干员匹配'].map(item => (
              <div key={item} className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">{item}</p>
                <p className="mt-1 text-xs text-muted-foreground">配置项占位，用于检查弹层内边距与栅格间距。</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLargeOpen(false)}>取消</Button>
            <Button onClick={() => setLargeOpen(false)}>开始导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent id="gallery-alert-dialog" aria-modal="true">
          <AlertDialogHeader>
            <AlertDialogTitle>清理旧日志文件？</AlertDialogTitle>
            <AlertDialogDescription>
              只保留最新的 10 MB 日志，已删除的文件无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => setAlertOpen(false)}>
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
        <SheetContent id="gallery-sheet-right" side="right" aria-modal="true">
          <SheetHeader>
            <SheetTitle>作业详情</SheetTitle>
            <SheetDescription>右侧抽屉承载与主工作区并列的补充信息。</SheetDescription>
          </SheetHeader>
          <div className="grid gap-2 px-4 text-sm">
            <p className="text-foreground">关卡 MAIN-1 · 理智 21</p>
            <p className="text-muted-foreground">抽屉正文滚动，标题与页脚保持固定。</p>
          </div>
          <SheetFooter>
            <Button id="gallery-sheet-open-dialog" variant="secondary" onClick={() => setSheetDialogOpen(true)}>在抽屉上打开对话框</Button>
            <Button id="gallery-sheet-right-close" onClick={() => setRightSheetOpen(false)}>关闭抽屉</Button>
          </SheetFooter>
          <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
            <DialogContent id="gallery-sheet-nested-dialog" aria-modal="true">
              <DialogHeader>
                <DialogTitle>复制作业链接</DialogTitle>
                <DialogDescription>对话框叠在抽屉之上，关闭后回到抽屉。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setSheetDialogOpen(false)}>完成</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SheetContent>
      </Sheet>

      <Sheet open={bottomSheetOpen} onOpenChange={setBottomSheetOpen}>
        <SheetContent id="gallery-sheet-bottom" side="bottom" aria-modal="true">
          <SheetHeader>
            <SheetTitle>更多页面</SheetTitle>
            <SheetDescription>移动端底部抽屉使用同一套 Sheet 原语。</SheetDescription>
          </SheetHeader>
          <div className="px-4 text-sm text-muted-foreground">
            抽屉内容按可用高度收缩，并预留底部安全区。
          </div>
          <SheetFooter>
            <Button onClick={() => setBottomSheetOpen(false)}>关闭抽屉</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
