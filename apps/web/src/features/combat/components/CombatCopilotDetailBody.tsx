import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FieldGroup } from '@/shared/ui/field'
import { Item, ItemActions, ItemGroup, ItemTitle } from '@/shared/ui/item'
import { InlineAlert, Loading } from '@/shared/components'
import { notify } from '@/shared/notifications'
import type { CopilotDetailOperator, CopilotDetailTarget, CopilotDetailTone } from '../model/copilotDetail'
import { DetailField, DetailSection } from './CombatCopilotDetailSection'
import CopilotDescription from './CopilotDescription'

const RECOMMENDED_MODE_LABELS = { normal: '普通', raid: '突袭', both: '普通+突袭' }

const STATUS_TONE_CLASS: Record<CopilotDetailTone, string> = {
  neutral: 'bg-primary-soft text-primary-strong',
  active: 'bg-primary-soft text-primary-strong',
  success: 'bg-success/10 text-success-text',
  warning: 'bg-warning/10 text-warning-text',
  danger: 'bg-destructive/10 text-destructive',
}

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
        <Badge
          variant="secondary"
          className={`justify-self-start ${STATUS_TONE_CLASS[target.statusTone ?? 'neutral']}`}
        >
          {target.statusLabel}
        </Badge>
      )}

      <FieldGroup className="combat-copilot-detail-grid grid gap-3">
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
                <Badge key={mode} variant="secondary" className="bg-success/10 text-success-text">
                  {mode === 'raid' ? '突袭已完成' : '普通已完成'}
                </Badge>
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
                <Copy data-icon="inline-start" aria-hidden="true" />
                复制链接
              </Button>
            </span>
          </DetailField>
        )}
      </FieldGroup>

      {target.details && (
        <DetailSection title="作业描述">
          <CopilotDescription text={target.details} />
        </DetailSection>
      )}

      {target.error && (
        <InlineAlert
          tone="error"
          title="失败原因"
          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {target.error}
        </InlineAlert>
      )}

      {operators.length > 0 && (
        <DetailSection title="干员需求">
          <div className="combat-copilot-detail-operators">
            {groupedOperators.map(([group, members]) => (
              <div key={group || 'fixed'} className="combat-copilot-detail-operator-group">
                {group && <h4 className="combat-copilot-detail-operator-group-name">{group}</h4>}
                <ItemGroup className="gap-2">
                  {members.map((operator, index) => {
                    const requirements = requirementLabels(operator)
                    return (
                      <Item
                        key={`${operator.name}-${index}`}
                        role="listitem"
                        size="xs"
                        className="gap-x-2 gap-y-1.5 rounded-none border-0 px-0 py-0.5"
                      >
                        <ItemTitle className="text-[0.8125rem] text-foreground">{operator.name}</ItemTitle>
                        {requirements.length > 0 && (
                          <ItemActions className="flex-wrap gap-1">
                            {requirements.map(label => (
                              <Badge key={label} variant="secondary" className="bg-muted text-tertiary">
                                {label}
                              </Badge>
                            ))}
                          </ItemActions>
                        )}
                      </Item>
                    )
                  })}
                </ItemGroup>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {groups.length > 0 && (
        <DetailSection title="干员组">
          <ul className="combat-copilot-detail-group-list">
            {groups.map(group => (
              <li key={group}>
                <Badge variant="secondary" className="bg-primary-soft text-primary-strong">{group}</Badge>
              </li>
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
