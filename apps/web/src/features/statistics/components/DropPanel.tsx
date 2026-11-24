import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { notify } from '@/shared/notifications'
import { dropStatisticsQueryOptions } from '../model/queries'
import DropRecords from './DropRecords'

const DROP_READ_ERROR = '暂时无法读取掉落记录，请检查服务连接后重试。'
const DROP_PERIOD_FALLBACK_NOTICE = '统计周期读取失败，已回退到最近成功的周期'
const DEFAULT_DROP_DAYS = 7

interface DropPanelProps {
  isActive: boolean
}

export default function DropPanel({ isActive }: DropPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const [dropDays, setDropDays] = useState(DEFAULT_DROP_DAYS)
  const [lastSuccessfulDays, setLastSuccessfulDays] = useState<number | null>(null)
  const [fallbackCount, setFallbackCount] = useState(0)
  const dropQuery = useQuery(dropStatisticsQueryOptions(dropDays))

  const hasSuccessfulRead = dropQuery.isSuccess
    && !dropQuery.isPlaceholderData
    && dropQuery.data !== undefined
    && dropQuery.fetchStatus === 'idle'
  if (hasSuccessfulRead && lastSuccessfulDays !== dropDays) {
    setLastSuccessfulDays(dropDays)
  }

  const isSettledError = dropQuery.isError && dropQuery.fetchStatus === 'idle'
  const fallbackTarget = isSettledError && lastSuccessfulDays !== null && lastSuccessfulDays !== dropDays
    ? lastSuccessfulDays
    : null
  if (fallbackTarget !== null) {
    setDropDays(fallbackTarget)
    setFallbackCount(count => count + 1)
  }

  useEffect(() => {
    if (fallbackCount === 0) return
    notify(DROP_PERIOD_FALLBACK_NOTICE, 'warning')
  }, [fallbackCount])

  if (!isActive) return null

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
      className="min-w-0"
    >
      <DropRecords
        dropStatistics={dropQuery.data ?? null}
        dropDays={dropDays}
        setDropDays={setDropDays}
        onRefresh={() => {
          void dropQuery.refetch()
        }}
        isLoading={dropQuery.isFetching}
        isPlaceholderData={dropQuery.isPlaceholderData}
        fetchStatus={dropQuery.fetchStatus}
        error={isSettledError && fallbackTarget === null ? DROP_READ_ERROR : null}
      />
    </motion.div>
  )
}
