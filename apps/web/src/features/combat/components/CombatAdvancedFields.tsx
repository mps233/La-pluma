import { motion } from 'framer-motion'
import { getCombatAdvancedOptions, type AdvancedValues } from '../model/combatCommands'

interface CombatAdvancedFieldsProps {
  taskId: string
  advanced: AdvancedValues
  onChange: (key: string, value: string | number | boolean) => void
}

export default function CombatAdvancedFields({
  taskId,
  advanced,
  onChange,
}: CombatAdvancedFieldsProps) {
  const options = getCombatAdvancedOptions(taskId)
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
            <label htmlFor={controlId} className="group flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 py-2 text-sm text-muted-foreground">
              <input
                id={controlId}
                type="checkbox"
                checked={advanced[option.key] as boolean || false}
                onChange={(e) => onChange(option.key, e.target.checked)}
                className="custom-checkbox h-4 w-4 cursor-pointer"
              />
              <span className="min-w-0 truncate transition-colors group-hover:text-primary">{option.label}</span>
            </label>
          ) : option.type === 'select' && option.options ? (
            <div className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
              <label htmlFor={controlId} className="text-sm text-muted-foreground">{option.label}</label>
              <select
                id={controlId}
                name={`maa-${taskId}-${option.key}`}
                value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                onChange={(e) => onChange(option.key, e.target.value)}
                className="app-input app-native-control min-h-11 min-w-0 control-surface"
              >
                {option.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
              <label htmlFor={controlId} className="text-sm text-muted-foreground">{option.label}</label>
              <input
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
                className="app-input app-native-control min-h-11 min-w-0 control-surface"
              />
            </div>
          )}
        </div>
        )
      })}
    </motion.div>
  )
}
