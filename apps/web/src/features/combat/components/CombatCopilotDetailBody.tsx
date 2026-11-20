import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Loading } from '@/shared/components'
import { notify } from '@/shared/notifications'
import type { CopilotDetailOperator, CopilotDetailTarget } from '../model/copilotDetail'
import { DetailField, DetailSection } from './CombatCopilotDetailSection'
import CopilotDescription from './CopilotDescription'

const RECOMMENDED_MODE_LABELS = { normal: '普通', raid: '突袭', both: '普通+突袭' }

function groupOperators(
  operators: readonly CopilotDetailOperator[],
): Array<[string, CopilotDetailOperator[]]> {
  const grouped = new Map<string, CopilotDetailOperator[]>()
  for (const operator of operators) {
    const key = operator.group?.trim() ?? ''
    const list = grouped.get(key)
    if (list) list.push(operator)
    else grouped.set(key, [operator])
  }
  return [...grouped.entries()]
}

function requirementLabels(operator: CopilotDetailOperator): string[] {
  const labels: string[] = []
  if (typeof operator.elite === 'number') labels.push(`精英 ${operator.elite}`)
  if (typeof operator.level === 'number') labels.push(`等级 ${operator.level}`)
  if (typeof operator.skillLevel === 'number') labels.push(`技能 ${operator.skillLevel}`)
  if (operator.module) labels.push(`模组 ${operator.module}`)
  return labels
}

export function DetailBody({ target, children }: { target: CopilotDetailTarget; children?: ReactNode }) {
  const operators = target.operators ?? []
  const groups = target.groups ?? []
  const groupedOperators = groupOperators(operators)
  const stageLabel = target.stage ?? target.stageId

  const handleCopy = async () => {
    if (!target.uri) return
    try {
      await navigator.clipboard.writeText(target.uri)
      notify('已复制作业链接', 'success')
    } catch {
      notify('复制失败，请手动选择链接', 'error')
    }
  }

  return (
    <div className="combat-copilot-detail-content">
      {target.statusLabel && (
        <span className={`combat-copilot-detail-state${target.statusTone ? ` is-${target.statusTone}` : ''}`}>
          {target.statusLabel}
        </span>
      )}

      <dl className="combat-copilot-detail-grid">
        {stageLabel && (
          <DetailField label="关卡">
            <span>{stageLabel}</span>
            {target.stageId && target.stageId !== stageLabel && (
              <code className="combat-copilot-detail-code">{target.stageId}</code>
            )}
          </DetailField>
        )}
        {typeof target.apCost === 'number' && (
          <DetailField label="理智">{target.apCost}</DetailField>
        )}
        {target.presetFormation !== undefined && (
          <DetailField label="编队">
            {target.presetFormation ? '预设编队 · 仅普通' : '按执行设置自动编队'}
          </DetailField>
        )}
        {target.sourceLabel && <DetailField label="来源">{target.sourceLabel}</DetailField>}
        {target.recommendedMode && (
          <DetailField label="作业标注">{RECOMMENDED_MODE_LABELS[target.recommendedMode]}</DetailField>
        )}
        {target.supportsRaid !== undefined && (
          <DetailField label="突袭">
            {target.supportsRaid ? '支持突袭' : '不支持突袭'}
          </DetailField>
        )}
        {target.completedModes?.length ? (
          <DetailField label="已完成模式" wide>
            <span className="combat-copilot-detail-tags">
              {target.completedModes.map(mode => (
                <span key={mode} className="combat-copilot-tag is-complete">
                  {mode === 'raid' ? '突袭已完成' : '普通已完成'}
                </span>
              ))}
            </span>
          </DetailField>
        ) : null}
        {target.uri && (
          <DetailField label="作业链接" wide>
            <span className="combat-copilot-detail-link">
              <code>{target.uri}</code>
              <Button
                onClick={() => void handleCopy()}
                variant="ghost"
                size="sm"
                className="min-h-11 shrink-0"
              >
                <Copy size={14} aria-hidden="true" />
                复制链接
              </Button>
            </span>
          </DetailField>
        )}
      </dl>

      {target.details && (
        <DetailSection title="作业描述">
          <CopilotDescription text={target.details} />
        </DetailSection>
      )}

      {target.error && (
        <Alert variant="destructive">
          <AlertTitle>失败原因</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {target.error}
          </AlertDescription>
        </Alert>
      )}

      {operators.length > 0 && (
        <DetailSection title="干员需求">
          <div className="combat-copilot-detail-operators">
            {groupedOperators.map(([group, members]) => (
              <div key={group || 'fixed'} className="combat-copilot-detail-operator-group">
                {group && <h4 className="combat-copilot-detail-operator-group-name">{group}</h4>}
                <ul className="combat-copilot-detail-operator-list">
                  {members.map((operator, index) => (
                    <li key={`${operator.name}-${index}`} className="combat-copilot-detail-operator">
                      <span className="combat-copilot-detail-operator-name">{operator.name}</span>
                      <span className="combat-copilot-detail-requirements">
                        {requirementLabels(operator).map(label => (
                          <span key={label} className="combat-copilot-detail-requirement">{label}</span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {groups.length > 0 && (
        <DetailSection title="干员组">
          <ul className="combat-copilot-detail-group-list">
            {groups.map(group => (
              <li key={group} className="combat-copilot-detail-group">{group}</li>
            ))}
          </ul>
        </DetailSection>
      )}
      {children}
    </div>
  )
}

export function DetailPlaceholder() {
  return (
    <div className="flex min-h-40 items-center justify-center px-2">
      <Loading text="正在加载作业…" />
    </div>
  )
}
