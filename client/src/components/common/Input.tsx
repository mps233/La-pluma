import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, type ChangeEvent } from 'react'

/**
 * 输入框组件 Props
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string
  placeholder?: string
  value: string | number
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'password' | 'email'
  disabled?: boolean
  error?: string
  hint?: string
  icon?: ReactNode
  className?: string
}

/**
 * 选择框组件 Props
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string
  value: string | number
  onChange: (value: string) => void
  options?: Array<{ value: string | number; label: string }>
  disabled?: boolean
  error?: string
  hint?: string
  className?: string
}

/**
 * 复选框组件 Props
 */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * 输入框组件
 * 统一的输入框样式
 */
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
        <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-secondary">
          {label}
        </label>
      )}
      
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
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
          className={`${baseStyles} ${error ? errorStyles : ''} ${icon ? 'pl-10' : ''}`}
          {...props}
        />
      </div>
      
      {error && (
        <p id={errorId} className="form-error-text mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
      
      {hint && !error && (
        <p id={hintId} className="mt-2 text-xs text-tertiary">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * 选择框组件
 */
export function Select({
  id,
  label,
  value,
  onChange,
  options = [],
  disabled = false,
  error,
  hint,
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
        <label htmlFor={selectId} className="mb-2 block text-sm font-medium text-secondary">
          {label}
        </label>
      )}
      
      <select
        id={selectId}
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={describedBy}
        aria-errormessage={error ? (ariaErrorMessage ?? errorId) : ariaErrorMessage}
        className={`${baseStyles} ${error ? errorStyles : ''}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      {error && (
        <p id={errorId} className="form-error-text mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
      
      {hint && !error && (
        <p id={hintId} className="mt-2 text-xs text-tertiary">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * 复选框组件
 */
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
        <span className="text-sm text-secondary transition-colors group-hover:text-[var(--app-accent)]">
          {label}
        </span>
      )}
    </label>
  )
}
