import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, type ChangeEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import HintTooltip from './HintTooltip.tsx'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string
  placeholder?: string
  value: string | number
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'password' | 'email'
  disabled?: boolean
  error?: string
  hint?: string
  hintPlacement?: 'below' | 'tooltip'
  icon?: ReactNode
  className?: string
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string
  value: string | number
  onChange: (value: string) => void
  options?: Array<{ value: string | number; label: string }>
  disabled?: boolean
  error?: string
  hint?: string
  hintPlacement?: 'below' | 'tooltip'
  className?: string
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export default function Input({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  disabled = false,
  error,
  hint,
  hintPlacement = 'below',
  icon,
  className = '',
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const generatedId = useId().replace(/:/g, '')
  const inputId = id ?? `input-${generatedId}`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const describedBy = [ariaDescribedBy, error ? errorId : hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ') || undefined
  // Keep shared native controls on the 44px iOS touch target and focus treatment.
  const baseStyles = 'input app-input app-native-control control-surface'
  const errorStyles = 'form-error-surface'
  
  return (
    <div className={className}>
      {label && (
        <FieldLabel
          htmlFor={inputId}
          label={label}
          hint={error ? undefined : hint}
          hintId={hintId}
          hintPlacement={hintPlacement}
        />
      )}
      
      <div className="relative">
        {icon && (
          <div className="app-input-leading-icon pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
            {icon}
          </div>
        )}
        
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={describedBy}
          aria-errormessage={error ? (ariaErrorMessage ?? errorId) : ariaErrorMessage}
          className={`${baseStyles} ${error ? errorStyles : ''} ${icon ? 'app-input-has-icon' : ''}`}
          autoComplete="off"
          {...props}
        />
      </div>
      
      {error && (
        <p id={errorId} className="form-error-text mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
      
      {hint && !error && hintPlacement !== 'tooltip' && (
        <p id={hintId} className="mt-2 text-xs text-tertiary">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Select({
  id,
  label,
  value,
  onChange,
  options = [],
  disabled = false,
  error,
  hint,
  hintPlacement = 'below',
  className = '',
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
  const generatedId = useId().replace(/:/g, '')
  const selectId = id ?? `select-${generatedId}`
  const errorId = `${selectId}-error`
  const hintId = `${selectId}-hint`
  const describedBy = [ariaDescribedBy, error ? errorId : hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ') || undefined
  const baseStyles = 'input app-input app-native-control control-surface'
  const errorStyles = 'form-error-surface'
  
  return (
    <div className={className}>
      {label && (
        <FieldLabel
          htmlFor={selectId}
          label={label}
          hint={error ? undefined : hint}
          hintId={hintId}
          hintPlacement={hintPlacement}
        />
      )}
      
      <div className="app-select-shell relative">
        <select
          id={selectId}
          value={value}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={describedBy}
          aria-errormessage={error ? (ariaErrorMessage ?? errorId) : ariaErrorMessage}
          className={`${baseStyles} app-select-control ${error ? errorStyles : ''}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          className={`app-select-trailing-icon ${disabled ? 'is-disabled' : ''}`}
          aria-hidden="true"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
        </span>
      </div>
      
      {error && (
        <p id={errorId} className="form-error-text mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
      
      {hint && !error && hintPlacement !== 'tooltip' && (
        <p id={hintId} className="mt-2 text-xs text-tertiary">
          {hint}
        </p>
      )}
    </div>
  )
}

interface FieldLabelProps {
  htmlFor: string
  label: string
  hint?: string
  hintId: string
  hintPlacement: 'below' | 'tooltip'
}

function FieldLabel({ htmlFor, label, hint, hintId, hintPlacement }: FieldLabelProps) {
  if (hintPlacement === 'tooltip' && hint) {
    return (
      <div className="mb-2 flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <HintTooltip id={hintId} label={label} hint={hint} />
      </div>
    )
  }

  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-muted-foreground">
      {label}
    </label>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  className = '',
  ...props
}: CheckboxProps) {
  return (
    <label className={`app-checkbox group ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        disabled={disabled}
        className="custom-checkbox cursor-pointer"
        {...props}
      />
      {label && (
        <span className="text-sm text-muted-foreground transition-colors group-hover:text-primary">
          {label}
        </span>
      )}
    </label>
  )
}
