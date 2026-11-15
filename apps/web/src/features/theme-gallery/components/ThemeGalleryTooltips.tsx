import { Info } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

export function ThemeGalleryTooltips() {
  return (
    <div data-region="gallery-tooltips">
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>提示层</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3.5 rounded-xl border border-border p-4 md:grid-cols-2">
            <div className="flex min-h-56 items-center justify-center">
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={<Button variant="outline" aria-label="上方长文案说明">上方长文案</Button>}
                />
                <TooltipContent role="tooltip" side="top" className="pointer-events-none">
                  使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限，留空表示不限制局数。
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex min-h-56 items-center justify-center">
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={<Button variant="secondary" aria-label="下方提示说明">下方提示</Button>}
                />
                <TooltipContent role="tooltip" side="bottom" className="pointer-events-none">
                  悬停或聚焦触发器时显示，空间不足会自动翻转方向。
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex min-h-56 items-center justify-center">
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={<Button size="icon-sm" variant="ghost" aria-label="左侧图标提示说明"><Info aria-hidden="true" /></Button>}
                />
                <TooltipContent role="tooltip" side="left" className="pointer-events-none">
                  图标触发器保留可访问名称。
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex min-h-56 items-center justify-center">
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={<Button variant="link" aria-label="右侧链接提示说明">右侧链接提示</Button>}
                />
                <TooltipContent role="tooltip" side="right" className="pointer-events-none">
                  链接样式触发器同样通过 render 承载。
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
