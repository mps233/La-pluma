import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { dropStatisticsQueryOptions } from '../model/queries'
import DropRecords from './DropRecords'

const DROP_READ_ERROR = '暂时无法读取掉落记录，请检查服务连接后重试。'

interface DropPanelProps {
  isActive: boolean
}

export default function DropPanel({ isActive }: DropPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const [dropDays, setDropDays] = useState(7)
  const dropQuery = useQuery(dropStatisticsQueryOptions(dropDays))

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
        error={dropQuery.isError ? DROP_READ_ERROR : null}
      />
    </motion.div>
  )
}
