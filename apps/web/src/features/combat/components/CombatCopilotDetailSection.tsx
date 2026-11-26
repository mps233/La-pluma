import type { ReactNode } from 'react'
import { Field, FieldContent, FieldTitle } from '@/shared/ui/field'

export function DetailField({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <Field
      aria-label={label}
      className={`combat-copilot-detail-field grid gap-0.5${wide ? ' combat-copilot-detail-wide' : ''}`}
    >
      <FieldTitle className="combat-copilot-detail-label text-xs font-normal">{label}</FieldTitle>
      <FieldContent className="combat-copilot-detail-value flex-row flex-wrap gap-x-2 gap-y-1.5 leading-[1.6]">
        {children}
      </FieldContent>
    </Field>
  )
}

export function DetailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="combat-copilot-detail-section">
      <h3 className="combat-copilot-detail-section-title">{title}</h3>
      {children}
    </section>
  )
}
