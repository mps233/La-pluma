import { Cpu, Database, HardDrive, Thermometer } from 'lucide-react'
import { SmoothPanel } from '@/shared/components'
import { useDashboardStore } from '../store/dashboardStore'
import { buildTemperatureSeries, getUsageTone, type UsageTone } from '../model/deviceView'

const labelClass = 'text-muted-foreground'
const progressTrackClass = 'h-1.5 rounded-full bg-muted overflow-hidden'

const getUsageBarClass = (tone: UsageTone) => {
  if (tone === 'danger') return 'bg-destructive'
  if (tone === 'warning') return 'bg-warning'
  return 'bg-primary'
}

const getUsageValueClass = (tone: UsageTone) => {
  if (tone === 'danger') return 'text-destructive'
  if (tone === 'warning') return 'text-warning'
  return 'text-foreground'
}

function TemperatureSparkline({ values }: { values: number[] }) {
  const series = buildTemperatureSeries(values)
  if (!series) {
    return <div className="dashboard-temperature-empty">等待温度采样</div>
  }

  return (
    <div className="dashboard-temperature-chart" aria-label={`最近温度 ${series.min.toFixed(1)} 到 ${series.max.toFixed(1)} 摄氏度`}>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="dashboard-temperature-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="14" x2="100" y2="14" className="dashboard-temperature-gridline" />
        <polygon points={series.areaPoints} fill="url(#dashboard-temperature-fill)" />
        <polyline points={series.points} className="dashboard-temperature-line" />
        <circle cx={series.lastPoint?.[0]} cy={series.lastPoint?.[1]} r="1.6" className="dashboard-temperature-dot" />
      </svg>
      <div className="dashboard-temperature-range">
        <span>{series.min.toFixed(0)}°</span>
        <span>{series.durationLabel}</span>
        <span>{series.max.toFixed(0)}°</span>
      </div>
    </div>
  )
}

export default function DashboardDeviceSection() {
  const deviceStats = useDashboardStore(state => state.deviceStats)
  const temperatureHistory = useDashboardStore(state => state.temperatureHistory)

  if (!deviceStats) return null

  return (
    <div className="dashboard-device-section">
      <div className="flex items-center gap-2">
        <div className="h-0.5 flex-1 bg-border rounded-full" />
        <span className={`text-xs font-medium ${labelClass} uppercase shrink-0`}>设备状态</span>
        <div className="h-0.5 flex-1 bg-border rounded-full" />
      </div>
      <div className="dashboard-device-grid">
        {([
          { label: 'CPU', pct: deviceStats.cpuPct, sub: deviceStats.load1m != null ? `负载 ${deviceStats.load1m.toFixed(1)}` : '', Icon: Cpu, value: undefined as string | undefined },
          { label: '内存', pct: deviceStats.memPct, sub: `${deviceStats.memUsed ?? '--'} / ${deviceStats.memTotal ?? '--'}`, Icon: Database, value: undefined as string | undefined },
          { label: '磁盘', pct: deviceStats.diskPct, sub: `${deviceStats.diskUsed ?? '--'} / ${deviceStats.diskTotal ?? '--'}`, Icon: HardDrive, value: undefined as string | undefined },
          { label: '温度', pct: undefined, sub: '', Icon: Thermometer, value: deviceStats.temp != null ? `${deviceStats.temp}°C` : '--' },
        ] as const).map(({ label, pct, sub, Icon, value }) => {
          const tone = getUsageTone(pct)
          return (
            <SmoothPanel
              key={label}
              cornerSize="compact"
              className="dashboard-device-card-shell group surface-panel-hover transition-colors"
              surfaceClassName="dashboard-device-card"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center text-tertiary">
                  <Icon className={`h-4 w-4 ${labelClass}`} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className={`truncate text-xs ${labelClass}`}>{sub || '实时采样'}</div>
                </div>
                {value != null && (
                  <div className="ml-auto text-sm font-semibold text-foreground">{value}</div>
                )}
              </div>
              {label === '温度' ? (
                <TemperatureSparkline values={temperatureHistory} />
              ) : pct != null && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs ${labelClass}`}>使用率</span>
                    <span className={`text-xs font-medium ${getUsageValueClass(tone)}`}>{pct}%</span>
                  </div>
                  <div className={progressTrackClass}>
                    <div className={`h-full rounded-full transition-all duration-700 ${getUsageBarClass(tone)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )}
            </SmoothPanel>
          )
        })}
      </div>
    </div>
  )
}
