import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, LoaderCircle, Save } from 'lucide-react'
import { getErrorMessage, isRecord } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/components/Modal'
import { FieldInput, FieldSelect } from './InfrastScheduleFieldControls'
import { saveInfrastSchedule } from '../api'
import {
  addInfrastPlan,
  createEmptyInfrastScheduleDocument,
  normalizeInfrastPlanIndex,
  removeInfrastPlan,
  resolveInfrastScheduleSaveRequest,
  updateInfrastDocumentMeta,
  updateInfrastPlanAt,
  updateInfrastPlanMeta,
  type InfrastScheduleTarget,
} from '../model/infrastScheduleEditing'
import {
  getInfrastPlanLabel,
  type InfrastPlan,
  type InfrastScheduleDocument,
} from '../model/infrastSchedule'
import { infrastScheduleListQueryOptions, infrastScheduleQueryOptions } from '../model/queries'
import InfrastScheduleRoomsEditor from './InfrastScheduleRoomsEditor'
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

  const updatePlan = (updater: (plan: InfrastPlan) => InfrastPlan) => {
    if (!document) return
    const current = document.plans[planIndex]
    if (!current) return
    setDocument(updateInfrastPlanAt(document, planIndex, updater(current)))
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
    <Modal
      isOpen
      onClose={onClose}
      title="自定义基建排班"
      size="xl"
      dismissible={!saving}
      closeOnOverlay={!saving}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3.5">
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
        </div>
      )}
    >
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
          <>
            <section className="space-y-3 border-t border-border pt-4">
              <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2">
                <FieldInput
                  id={`${editorId}-document-title`}
                  label="排班表标题"
                  value={typeof document.title === 'string' ? document.title : ''}
                  placeholder="可选"
                  disabled={saving}
                  onChange={event => setDocument(updateInfrastDocumentMeta(document, { title: event.target.value }))}
                />
                <FieldInput
                  id={`${editorId}-document-description`}
                  label="排班表说明"
                  value={typeof document.description === 'string' ? document.description : ''}
                  placeholder="可选"
                  disabled={saving}
                  onChange={event => setDocument(updateInfrastDocumentMeta(document, { description: event.target.value }))}
                />
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-end gap-2">
                <FieldSelect
                  id={`${editorId}-plan-index`}
                  label="方案"
                  className="min-w-0 flex-1"
                  value={String(planIndex)}
                  items={document.plans.map((current, index) => ({ value: String(index), label: getInfrastPlanLabel(current, index) }))}
                  disabled={saving}
                  onValueChange={value => setPlanIndex(normalizeInfrastPlanIndex(value, document.plans.length))}
                />
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    const added = addInfrastPlan(document)
                    setDocument(added.document)
                    setPlanIndex(added.index)
                  }}
                >
                  添加方案
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving || document.plans.length <= 1}
                  onClick={() => {
                    const removed = removeInfrastPlan(document, planIndex)
                    setDocument(removed.document)
                    setPlanIndex(removed.index)
                  }}
                >
                  删除方案
                </Button>
              </div>
              <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2">
                <FieldInput
                  id={`${editorId}-plan-name`}
                  label="方案名称"
                  value={typeof plan.name === 'string' ? plan.name : ''}
                  placeholder="例如：早班"
                  disabled={saving}
                  onChange={event => updatePlan(current => updateInfrastPlanMeta(current, { name: event.target.value }))}
                />
                <FieldInput
                  id={`${editorId}-plan-description`}
                  label="方案说明"
                  value={typeof plan.description === 'string' ? plan.description : ''}
                  placeholder="可选"
                  disabled={saving}
                  onChange={event => updatePlan(current => updateInfrastPlanMeta(current, { description: event.target.value }))}
                />
              </div>
            </section>

            <section className="space-y-2 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-foreground">房间</h4>
              <InfrastScheduleRoomsEditor
                plan={plan}
                disabled={saving}
                onChange={next => updatePlan(() => next)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                无人机、菲亚梅塔、干员编组、时间段与其他扩展字段不在本编辑器内，保存时原样保留。
              </p>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            输入或选择已有排班文件后点击“加载”；新文件可点击“新建排班”后再保存。
          </p>
        )}

      </div>
    </Modal>
  )
}
