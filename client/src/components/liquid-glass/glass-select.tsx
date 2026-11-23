'use client'

// GlassSelect — a select whose list is one body of liquid glass with its trigger: it swells out
// of the whole button, holds on by a neck that thins and snaps, and closes by the same motion
// played backwards (GlassPopup, `glass-popup.tsx`).
//
//   <GlassSelect label="Role" placeholder="Pick a role" options={[{ value: 'admin', label: 'Admin' }]} />
//
// UI SDK owns the behaviour (keyboard, typeahead, focus, the top layer, positioning, ARIA); the
// kit's engine owns the material. Needs @ui-sdk/core and @ui-sdk/react.
// Without WebGL2 it is a plain frosted list.

import { Select, SelectContent, SelectItem, SelectLabel, SelectList, SelectTrigger, SelectValue } from '@ui-sdk/react/select'
import type { CSSProperties, ReactNode } from 'react'

import { GlassPopupAnchor, GlassPopupSurface, useGlassPopup } from './glass-popup'

export type GlassSelectOption = { value: string; label: ReactNode; disabled?: boolean }

export type GlassSelectProps = {
  label: ReactNode
  options: GlassSelectOption[]
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
  placeholder?: string
  disabled?: boolean
  name?: string
  className?: string
}

export function GlassSelect({ label, options, value, defaultValue, onValueChange, placeholder, disabled, name, className = '' }: GlassSelectProps) {
  const popup = useGlassPopup({ matchWidth: true })
  const controlled = value !== undefined ? { value } : {}
  const initial = defaultValue !== undefined ? { defaultValue } : {}

  return (
    <Select
      {...controlled}
      {...initial}
      onValueChange={(next: unknown) => onValueChange?.((next as string | null) ?? null)}
      placeholder={placeholder}
      disabled={disabled}
      name={name}
    >
      <div className={`flex w-64 flex-col gap-2 ${className}`}>
        <SelectLabel className="text-sm font-medium text-neutral-900 dark:text-white">{label}</SelectLabel>
        <SelectTrigger
          data-glass-host=""
          className="flex h-12 w-full cursor-pointer items-center justify-between rounded-full border border-black/10 bg-white/60 pr-4 pl-5 text-[15px] font-medium text-neutral-900 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900"
        >
          <GlassPopupAnchor popup={popup} />
          <SelectValue />
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 opacity-60">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </SelectTrigger>
      </div>
      <SelectContent
        data-glass-popup=""
        data-glass-skip=""
        sideOffset={12}
        className="rounded-3xl p-1.5 text-[15px] text-neutral-900 outline-none data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900"
      >
        <GlassPopupSurface popup={popup} />
        <SelectList className="max-h-72 overflow-y-auto rounded-[18px] outline-none">
          {options.map((o, i) => (
            <SelectItem
              key={o.value}
              value={o.value}
              disabled={o.disabled}
              style={{ '--glass-i': i } as CSSProperties}
              className="relative flex h-10 cursor-pointer items-center rounded-2xl px-3.5 font-medium outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-black/8 data-[selected]:font-semibold dark:data-[highlighted]:bg-white/12"
            >
              {o.label}
            </SelectItem>
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  )
}

export default GlassSelect
