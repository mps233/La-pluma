import type { TaskParamField } from '../types'

export interface AutomationSelectItem {
  value: string
  label: string
}

export const asSelectItems = (options: TaskParamField['options']): AutomationSelectItem[] => {
  const items: AutomationSelectItem[] = []
  for (const option of options ?? []) {
    items.push(typeof option === 'object' ? option : { value: option, label: option })
  }
  return items
}
