import { AlertTriangle, Cable, CheckCircle2, LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { ConnectionTestStatus } from '../types'

interface StartupConnectionTestProps {
  taskId: string
  enabled: boolean
  isEditingLocked: boolean
  testingTaskId: string | null
  feedback?: ConnectionTestStatus
  onTestConnection: (taskId: string) => void
}

export default function StartupConnectionTest({
  taskId,
  enabled,
  isEditingLocked,
  testingTaskId,
  feedback,
  onTestConnection,
}: StartupConnectionTestProps) {
  const isTesting = testingTaskId === taskId
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
      <Button
        type="button"
        variant="secondary"
        onClick={() => { void onTestConnection(taskId) }}
        disabled={isEditingLocked || !enabled || testingTaskId !== null || isTesting}
        data-status-key={isTesting ? 'testing' : feedback?.success ? 'success' : feedback ? 'error' : 'idle'}
        aria-busy={isTesting || undefined}
        className={`automation-test-connection w-full${isTesting ? ' is-testing' : ''}`}
      >
        {isTesting
          ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在检查</>
          : (
            <>
              {feedback?.success
                ? <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                : feedback
                  ? <AlertTriangle size={16} strokeWidth={2.2} aria-hidden="true" />
                  : <Cable size={16} strokeWidth={2.1} aria-hidden="true" />}
              {feedback ? '重新测试' : '测试连接'}
            </>
          )}
      </Button>
    </div>
  )
}
