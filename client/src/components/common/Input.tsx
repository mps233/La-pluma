import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, ChangeEvent } from 'react'

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
 * 文本域组件 Props
 */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  error?: string
  hint?: string
  rows?: number
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
  color?: 'violet' | 'emerald' | 'cyan' | 'orange' | 'fuchsia'
  className?: string
}

/**
 * 输入框组件
 * 统一的输入框样式
 */
export default function Input({
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
  ...props
}: InputProps) {
  const baseStyles = 'w-full px-4 py-3 border rounded-2xl text-sm font-medium transition-all focus:outline-none focus:ring-2'
  const normalStyles = 'border-gray-300 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-violet-500 focus:border-transparent'
  const errorStyles = 'border-rose-300 dark:border-rose-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-rose-500 focus:border-transparent'
  const disabledStyles = 'opacity-50 cursor-not-allowed'
  
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        )}
        
        <input
          type={type}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`${baseStyles} ${error ? errorStyles : normalStyles} ${disabled ? disabledStyles : ''} ${icon ? 'pl-10' : ''}`}
          {...props}
        />
      </div>
      
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
      
      {hint && !error && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * 文本域组件
 */
export function Textarea({
  label,
  placeholder,
  value,
  onChange,
  disabled = false,
  error,
  hint,
  rows = 4,
  className = '',
  ...props
}: TextareaProps) {
  const baseStyles = 'w-full px-4 py-3 border rounded-2xl text-sm font-medium transition-all focus:outline-none focus:ring-2 resize-none'
  const normalStyles = 'border-gray-300 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-violet-500 focus:border-transparent'
  const errorStyles = 'border-rose-300 dark:border-rose-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-rose-500 focus:border-transparent'
  const disabledStyles = 'opacity-50 cursor-not-allowed'
  
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      
      <textarea
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={`${baseStyles} ${error ? errorStyles : normalStyles} ${disabled ? disabledStyles : ''}`}
        {...props}
      />
      
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
      
      {hint && !error && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
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
  label,
  value,
  onChange,
  options = [],
  disabled = false,
  error,
  hint,
  className = '',
  ...props
}: SelectProps) {
  const baseStyles = 'w-full px-4 py-3 border rounded-2xl text-sm font-medium transition-all focus:outline-none focus:ring-2'
  const normalStyles = 'border-gray-300 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-violet-500 focus:border-transparent'
  const errorStyles = 'border-rose-300 dark:border-rose-500/50 text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:ring-rose-500 focus:border-transparent'
  const disabledStyles = 'opacity-50 cursor-not-allowed'
  
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        disabled={disabled}
        className={`${baseStyles} ${error ? errorStyles : normalStyles} ${disabled ? disabledStyles : ''}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
      
      {hint && !error && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
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
  color = 'violet',
  className = '',
  ...props
}: CheckboxProps) {
  const colorStyles: Record<string, string> = {
    violet: 'custom-checkbox-violet',
    emerald: 'custom-checkbox-emerald',
    cyan: 'custom-checkbox-cyan',
    orange: 'custom-checkbox-orange',
    fuchsia: 'custom-checkbox-fuchsia',
  }
  
  return (
    <label className={`flex items-center space-x-2 cursor-pointer group ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        disabled={disabled}
        className={`${colorStyles[color]} cursor-pointer`}
        {...props}
      />
      {label && (
        <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
          {label}
        </span>
      )}
    </label>
  )
}
