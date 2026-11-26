import { motion } from 'framer-motion'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { getCombatAdvancedOptions, type AdvancedValues } from '../model/combatCommands'

interface CombatAdvancedFieldsProps {
  taskId: string
  advanced: AdvancedValues
  hiddenKeys?: readonly string[]
  onChange: (key: string, value: string | number | boolean) => void
}

export default function CombatAdvancedFields({
  taskId,
  advanced,
  hiddenKeys,
  onChange,
}: CombatAdvancedFieldsProps) {
  const hidden = new Set(hiddenKeys)
  const options = getCombatAdvancedOptions(taskId).filter(option => !hidden.has(option.key))
  if (options.length === 0) return null

  return (
    <motion.div
      className="mt-3 space-y-3 border-t border-border pt-3"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.3 }}
    >
      {options.map(option => {
        const controlId = `combat-${taskId}-${option.key}`
        return (
        <div key={option.key} className="min-w-0">
          {option.type === 'checkbox' ? (
            <Field orientation="horizontal" className="min-h-11 w-full min-w-0 gap-2 py-2">
              <Checkbox
                id={controlId}
                checked={advanced[option.key] as boolean || false}
                onCheckedChange={(checked) => onChange(option.key, checked)}
              />
              <FieldLabel
                htmlFor={controlId}
                className="min-w-0 cursor-pointer truncate text-sm font-normal text-muted-foreground transition-colors hover:text-primary"
              >
                {option.label}
              </FieldLabel>
            </Field>
          ) : option.type === 'select' && option.options ? (
            <Field orientation="horizontal" className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
              <FieldLabel htmlFor={controlId} className="text-sm font-normal text-muted-foreground">{option.label}</FieldLabel>
              <Select
                name={`maa-${taskId}-${option.key}`}
                items={option.options}
                value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onChange(option.key, next) }}
              >
                <SelectTrigger id={controlId} className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {option.options.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field orientation="horizontal" className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
              <FieldLabel htmlFor={controlId} className="text-sm font-normal text-muted-foreground">{option.label}</FieldLabel>
              <Input
                id={controlId}
                type={option.type}
                name={`maa-${taskId}-${option.key}`}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={advanced[option.key] as string || ''}
                onChange={(e) => onChange(option.key, e.target.value)}
                placeholder={option.placeholder}
                className="min-w-0"
              />
            </Field>
          )}
        </div>
        )
      })}
    </motion.div>
  )
}
