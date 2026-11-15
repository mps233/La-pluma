import { useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

interface FieldHintProps {
  id: string
  label: string
  hint: string
}

const isCoarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

export default function FieldHint({ id, label, hint }: FieldHintProps) {
  const [open, setOpen] = useState(false)
  const lastPointerTypeRef = useRef<string | null>(null)

  return (
    <Tooltip
      open={open}
      onOpenChange={(next, details) => {
        // 触屏设备仍会收到 Base UI 合成的 hover 事件；忽略 hover 开关，避免 tap
        // 打开的提示被残留鼠标位置或替换流程关闭。混合设备上的触屏打开同理。
        if (details.reason === 'trigger-hover' && isCoarsePointer()) return
        if (!next && details.reason === 'trigger-hover' && lastPointerTypeRef.current === 'touch') return
        setOpen(next)
      }}
      disableHoverablePopup
    >
      <TooltipTrigger
        render={<button type="button" className="-my-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-tertiary transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary" />}
        aria-label={`${label}说明`}
        aria-describedby={open ? id : undefined}
        closeOnClick={false}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onPointerEnter={(event) => {
          lastPointerTypeRef.current = event.pointerType
        }}
        onPointerDown={(event) => {
          lastPointerTypeRef.current = event.pointerType
        }}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent id={id} role="tooltip" side="bottom" sideOffset={6} className="pointer-events-none">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}
