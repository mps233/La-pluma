import type { CombatMode, CombatTask } from '../types'

export const COMBAT_TASKS: Record<CombatMode, CombatTask> = {
  copilot: {
    id: 'copilot',
    name: '普通作业',
    command: 'copilot',
    placeholder: 'prts://1234、作业站链接或本地文件路径',
    hasAdvanced: true,
  },
  ssscopilot: {
    id: 'ssscopilot',
    name: '保全派驻',
    command: 'ssscopilot',
    placeholder: 'prts://1234 或本地文件路径',
    hasAdvanced: true,
  },
  paradoxcopilot: {
    id: 'paradoxcopilot',
    name: '悖论模拟',
    command: 'paradoxcopilot',
    placeholder: 'prts://1234 或本地文件路径',
    hasAdvanced: true,
  },
}

export const COMBAT_MODE_OPTIONS: ReadonlyArray<{
  id: CombatMode
  title: string
}> = [
  {
    id: 'copilot',
    title: COMBAT_TASKS.copilot.name,
  },
  {
    id: 'ssscopilot',
    title: COMBAT_TASKS.ssscopilot.name,
  },
  {
    id: 'paradoxcopilot',
    title: COMBAT_TASKS.paradoxcopilot.name,
  },
]

export function getCombatTask(mode: CombatMode): CombatTask {
  return COMBAT_TASKS[mode]
}
