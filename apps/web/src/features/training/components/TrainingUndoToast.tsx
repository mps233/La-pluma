import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { UndoToastCard } from '@/shared/components'

const TRAINING_UNDO_TOAST_ID = 'training-undo-toast'

export interface TrainingUndoToastProps {
  name: string
  pending: boolean
  onUndo: () => void
  onDismiss: () => void
}

export default function TrainingUndoToast({ name, pending, onUndo, onDismiss }: TrainingUndoToastProps) {
  const callbacksRef = useRef({ onUndo, onDismiss })

  useEffect(() => {
    callbacksRef.current = { onUndo, onDismiss }
  }, [onDismiss, onUndo])

  useEffect(() => {
    toast.custom(() => (
      <UndoToastCard
        message={`已移除 ${name}`}
        pending={pending}
        onUndo={() => callbacksRef.current.onUndo()}
        onDismiss={() => callbacksRef.current.onDismiss()}
      />
    ), {
      id: TRAINING_UNDO_TOAST_ID,
      duration: Infinity,
      dismissible: false,
    })
  }, [name, pending])

  useEffect(() => () => {
    toast.dismiss(TRAINING_UNDO_TOAST_ID)
  }, [])

  return null
}
