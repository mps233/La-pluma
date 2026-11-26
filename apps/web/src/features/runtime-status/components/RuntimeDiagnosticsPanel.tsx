import { AlertTriangle, CheckCircle2, CircleHelp, LoaderCircle, XCircle } from 'lucide-react'
import { EmptyState, InlineAlert } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/shared/ui/field'
import type {
  RuntimeDiagnosticCheck,
  RuntimeDiagnosticCheckStatus,
  RuntimeDiagnosticsStatus,
} from '../api/diagnostics'
import { useRuntimeDiagnostics } from '../hooks/useRuntimeDiagnostics'

interface RuntimeDiagnosticsPanelProps {
  command?: string
  className?: string
}

const CHECK_META: Record<
  RuntimeDiagnosticCheckStatus,
  { label: string; surface: string; Icon: typeof CheckCircle2 }
> = {
  pass: { label: '通过', surface: 'status-success', Icon: CheckCircle2 },
  warn: { label: '注意', surface: 'status-warning', Icon: AlertTriangle },
  fail: { label: '失败', surface: 'status-danger', Icon: XCircle },
  unknown: { label: '未知', surface: 'surface-soft text-muted-foreground', Icon: CircleHelp },
}

const REPORT_META: Record<RuntimeDiagnosticsStatus, { label: string; surface: string }> = {
  ok: { label: '正常', surface: 'status-success' },
  warn: { label: '需要留意', surface: 'status-warning' },
  error: { label: '存在问题', surface: 'status-danger' },
}

function DiagnosticsCheckItem({ check }: { check: RuntimeDiagnosticCheck }) {
  const meta = CHECK_META[check.status]
  const Icon = meta.Icon

  return (
    <li className={`min-w-0 rounded-lg px-3 py-2.5 ${meta.surface}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Icon size={15} strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{check.title}</span>
        <span className="text-xs font-semibold">{meta.label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.summary}</p>
      {check.details.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
          {check.details.map((detail, index) => (
            <li key={`${detail}-${index}`} className="wrap-break-word">{detail}</li>
          ))}
        </ul>
      )}
      {check.hint && <p className="mt-2 text-xs leading-5 text-muted-foreground">建议：{check.hint}</p>}
      {check.locations && check.locations.length > 0 && (
        <p className="mt-1 text-xs leading-5 text-tertiary">定位：{check.locations.join('、')}</p>
      )}
    </li>
  )
}

export default function RuntimeDiagnosticsPanel({
  command,
  className = '',
}: RuntimeDiagnosticsPanelProps) {
  const { status, report, error, start } = useRuntimeDiagnostics(command)
  const loading = status === 'loading'
  const reportMeta = report ? REPORT_META[report.status] : null

  return (
    <section
      className={`min-w-0 ${className}`.trim()}
      aria-label="辅助诊断"
      aria-busy={loading || undefined}
    >
      <Field orientation="horizontal" className="gap-3.5">
        <FieldContent className="gap-0.5">
          <FieldTitle role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
            辅助诊断
          </FieldTitle>
          <FieldDescription className="text-xs leading-5 text-tertiary">
            检查运行环境、设备连接、资源与执行链路，不会启动任务。
          </FieldDescription>
        </FieldContent>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 shrink-0"
          disabled={loading}
          aria-busy={loading || undefined}
          onClick={start}
        >
          {loading
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />诊断中</>
            : '运行诊断'}
        </Button>
      </Field>

      {error && (
        <InlineAlert
          tone="warning"
          className="mt-3"
          onRetry={start}
          retrying={loading}
        >
          {error}
        </InlineAlert>
      )}

      <div className="mt-3" role="status" aria-live="polite">
        {!report && status === 'loading' && (
          <p className="text-xs leading-5 text-tertiary">正在检查运行环境与执行链路…</p>
        )}
        {!report && status === 'idle' && (
          <EmptyState
            compact
            icon={<CircleHelp size={20} strokeWidth={1.8} aria-hidden="true" />}
            title="尚未运行诊断"
            description="运行诊断后会列出环境、连接与执行链路的检查结果。"
          />
        )}
        {report && reportMeta && (
          <div className="min-w-0">
            <div className={`flex min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${reportMeta.surface}`}>
              <span className="text-xs font-semibold">{reportMeta.label}</span>
              <span className="min-w-0 flex-1 text-sm leading-5">{report.conclusion}</span>
            </div>
            <ul className="mt-2 space-y-2">
              {report.checks.map((check, index) => (
                <DiagnosticsCheckItem key={`${check.id}-${index}`} check={check} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
