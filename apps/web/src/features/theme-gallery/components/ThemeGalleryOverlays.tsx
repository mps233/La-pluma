import { useState } from 'react'
import { toast } from 'sonner'
import { UndoToastCard } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

const GALLERY_FILTER_OPTIONS = [
  { value: 'default', label: '默认顺序' },
  { value: 'rarity', label: '星级降序' },
  { value: 'level', label: '等级降序' },
] as const

const GALLERY_TOAST_ID = 'gallery-undo-toast'

export function ThemeGalleryOverlays() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sort, setSort] = useState('default')

  const dismissToast = () => {
    toast.dismiss(GALLERY_TOAST_ID)
  }

  return (
    <div data-region="gallery-overlays">
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle role="heading" aria-level={3}>菜单与提示</CardTitle>
          <CardDescription>DropdownMenu 打开态与撤销提示；菜单选项使用 radio 语义。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              id="gallery-dropdown-trigger"
              render={<Button variant="secondary" />}
            >
              筛选排序
            </DropdownMenuTrigger>
            <DropdownMenuContent aria-label="筛选排序" align="start" className="min-w-40">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(next) => {
                  setSort(String(next))
                  setMenuOpen(false)
                }}
              >
                {GALLERY_FILTER_OPTIONS.map(option => (
                  <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="secondary"
            onClick={() => {
              toast.custom(() => (
                <UndoToastCard
                  message="已移除 阿米娅"
                  pending={false}
                  onUndo={dismissToast}
                  onDismiss={dismissToast}
                />
              ), { id: GALLERY_TOAST_ID, duration: Infinity, dismissible: false })
            }}
          >
            显示可撤销提示
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              toast.custom(() => (
                <UndoToastCard
                  message="已移除 阿米娅"
                  pending
                  onUndo={() => {}}
                  onDismiss={dismissToast}
                />
              ), { id: GALLERY_TOAST_ID, duration: Infinity, dismissible: false })
            }}
          >
            显示恢复中提示
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
