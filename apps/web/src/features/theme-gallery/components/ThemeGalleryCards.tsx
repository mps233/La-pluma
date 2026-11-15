import { Button } from '@/shared/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

export function ThemeGalleryCards() {
  return (
    <div data-region="gallery-card-surfaces">
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>卡片与面板</CardTitle>
          <CardDescription>完整 Card 组合、无内边距面板表面与骨架占位。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="border-b py-3.5">
              <CardTitle role="heading" aria-level={3}>完整组合</CardTitle>
              <CardDescription>标题、描述、操作、内容与页脚。</CardDescription>
              <CardAction>
                <Button size="xs" variant="outline">操作</Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">卡片内容使用 shadcn 语义间距。</p>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <span className="text-xs text-muted-foreground">页脚说明</span>
              <Button size="xs">确认</Button>
            </CardFooter>
          </Card>

          <Card size="sm">
            <CardHeader className="border-b py-3.5">
              <CardTitle role="heading" aria-level={3}>小尺寸</CardTitle>
              <CardDescription>size=&quot;sm&quot; 使用更紧凑的间距。</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">适合信息密度更高的卡片。</p>
            </CardContent>
            <CardFooter>
              <span className="text-xs text-muted-foreground">紧凑页脚</span>
            </CardFooter>
          </Card>

          <Card className="gap-0 p-0!">
            <div className="border-b border-border px-4 py-3.5 text-sm font-semibold">面板标题</div>
            <div className="px-4 py-4 text-sm text-muted-foreground">由分节标题、内容与页脚组成的独立面板表面。</div>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">面板页脚</div>
          </Card>

          <Card className="gap-0 p-0!">
            <div className="border-b border-border px-4 py-3.5">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-10 flex-1 rounded-xl" />
              </div>
            </div>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
