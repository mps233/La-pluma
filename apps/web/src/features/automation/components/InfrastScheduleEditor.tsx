import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, LoaderCircle, Save } from 'lucide-react'
import { getErrorMessage, isRecord } from '@/shared/api'
import { DialogBody, DialogFrame, DialogFrameFooter } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { FieldInput } from './InfrastScheduleFieldControls'
import { saveInfrastSchedule } from '../api'
import {
  createEmptyInfrastScheduleDocument,
  normalizeInfrastPlanIndex,
  resolveInfrastScheduleSaveRequest,
  updateInfrastPlanAt,
  type InfrastScheduleTarget,
} from '../model/infrastScheduleEditing'
import type { InfrastScheduleDocument } from '../model/infrastSchedule'
import { infrastScheduleListQueryOptions, infrastScheduleQueryOptions } from '../model/queries'
import InfrastSchedulePlanMeta from './InfrastSchedulePlanMeta'
import InfrastScheduleFileList from './InfrastScheduleFileList'

interface InfrastScheduleEditorProps {
  filename: string
  initialPlanIndex: number
  onClose: () => void
  onSaved: (target: InfrastScheduleTarget) => void
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '排班文件操作失败'
}

export default function InfrastScheduleEditor({
  filename,
  initialPlanIndex,
  onClose,
  onSaved,
}: InfrastScheduleEditorProps) {
  const queryClient = useQueryClient()
  const editorId = useId().replace(/:/g, '')
  const [name, setName] = useState(filename)
  const [loadName, setLoadName] = useState(filename.trim())
  const [document, setDocument] = useState<InfrastScheduleDocument | null>(null)
  const [documentName, setDocumentName] = useState<string | null>(null)
  const [planIndex, setPlanIndex] = useState(initialPlanIndex)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const appliedRef = useRef<string | null>(null)
  const listQuery = useQuery(infrastScheduleListQueryOptions())
  const scheduleQuery = useQuery(infrastScheduleQueryOptions(loadName))
  const loading = scheduleQuery.isFetching && Boolean(loadName)

  useEffect(() => {
    const payload = scheduleQuery.data
    if (!payload || appliedRef.current === payload.name) return
    appliedRef.current = payload.name
    setDocument(payload.document)
    setDocumentName(payload.name)
    setName(payload.name)
    setPlanIndex(current => normalizeInfrastPlanIndex(current, payload.document.plans.length))
    setError(null)
  }, [scheduleQuery.data])

  useEffect(() => {
    if (!scheduleQuery.isError || !loadName) return
    setDocument(null)
    setDocumentName(null)
    setError(describeError(scheduleQuery.error))
  }, [scheduleQuery.isError, scheduleQuery.error, loadName])

  const load = () => {
    const target = name.trim()
    if (!target) {
      setError('请填写排班文件名')
      return
    }
    setError(null)
    if (target === loadName) {
      appliedRef.current = null
      void queryClient.invalidateQueries({ queryKey: infrastScheduleQueryOptions(target).queryKey })
      return
    }
    setLoadName(target)
  }

  const createNew = () => {
    const target = name.trim()
    if (!target) {
      setError('请先填写排班文件名，例如 schedules/base.json')
      return
    }
    appliedRef.current = null
    setDocument(createEmptyInfrastScheduleDocument())
    setDocumentName(target)
    setPlanIndex(0)
    setError(null)
  }

  const save = async () => {
    if (!document) return
    const request = resolveInfrastScheduleSaveRequest(name, documentName, document)
    if (!request.ok) {
      setError(request.message)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await saveInfrastSchedule(request.target, document)
      if (!result.success) {
        setError(getErrorMessage(result))
        return
      }
      const savedName = isRecord(result.data) && typeof result.data.name === 'string'
        ? result.data.name
        : request.target
      appliedRef.current = savedName
      setDocumentName(savedName)
      setName(savedName)
      setLoadName(savedName)
      queryClient.setQueryData(infrastScheduleQueryOptions(savedName).queryKey, { name: savedName, document })
      void queryClient.invalidateQueries({ queryKey: infrastScheduleListQueryOptions().queryKey })
      onSaved({ filename: savedName, planIndex: normalizeInfrastPlanIndex(planIndex, document.plans.length) })
    } catch (saveError) {
      setError(describeError(saveError))
    } finally {
      setSaving(false)
    }
  }

  const plan = document?.plans[planIndex]
  const schedules = listQuery.data?.schedules ?? []
  return (
    <DialogFrame
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title="自定义基建排班"
      size="4xl"
      closeDisabled={saving}
      disablePointerDismissal={saving}
      footer={(
        <DialogFrameFooter align="between">
          <span className="text-xs text-muted-foreground">
            {document ? `${document.plans.length} 个方案` : '未加载排班文件'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
            <Button disabled={!document || saving} aria-busy={saving || undefined} onClick={() => void save()}>
              {saving
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />保存中...</>
                : <><Save size={15} aria-hidden="true" />保存</>}
            </Button>
          </div>
        </DialogFrameFooter>
      )}
    >
      <DialogBody>
        <div className="@container space-y-3.5">
          {error && (
            <div role="alert" className="status-danger flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <FieldInput
                id={`${editorId}-filename`}
                label="排班文件"
                className="min-w-0 flex-1"
                value={name}
                placeholder="schedules/base.json"
                disabled={saving}
                onChange={event => setName(event.target.value)}
              />
              <Button variant="secondary" disabled={saving || loading} onClick={load}>加载</Button>
              <Button variant="secondary" disabled={saving || loading} onClick={createNew}>新建排班</Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              相对路径基于 MAA 配置目录的 infrast 文件夹，与 maa-cli 解析 filename 的规则一致；保存时省略默认值，未编辑的房间保持原样。
            </p>

            {listQuery.data && (
              <InfrastScheduleFileList
                directory={listQuery.data.directory}
                schedules={schedules}
                disabled={saving}
                onSelect={name => {
                  setName(name)
                  setLoadName(name)
                  setError(null)
                }}
              />
            )}
          </section>

          {document && plan ? (
            <InfrastSchedulePlanMeta
              editorId={editorId}
              document={document}
              plan={plan}
              planIndex={planIndex}
              saving={saving}
              onDocumentChange={setDocument}
              onPlanIndexChange={setPlanIndex}
              onPlanChange={updater => {
                const current = document.plans[planIndex]
                if (!current) return
                setDocument(updateInfrastPlanAt(document, planIndex, updater(current)))
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              输入或选择已有排班文件后点击“加载”；新文件可点击“新建排班”后再保存。
            </p>
          )}

        </div>
      </DialogBody>
    </DialogFrame>
  )
}
