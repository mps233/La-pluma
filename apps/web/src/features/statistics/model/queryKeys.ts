import { defineQueryKeys } from '@/shared/query'

export const STATISTICS_DOMAIN = 'statistics' as const

export const statisticsKeys = defineQueryKeys(STATISTICS_DOMAIN)
