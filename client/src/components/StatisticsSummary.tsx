import type { ReactNode } from 'react'

export interface ReadoutStat {
  label: string
  value: ReactNode
  unit?: string
  muted?: boolean
}

export interface ReadoutMeta {
  label?: string
  value: ReactNode
}

interface StatisticsSummaryProps {
  ariaLabel: string
  primary: {
    label: string
    value: ReactNode
    unit?: string
    detail?: ReactNode
    meter?: number
    meterLabel?: string
    meterText?: string
  }
  stats: ReadoutStat[]
  meta?: ReadoutMeta[]
  className?: string
}

/**
 * A quiet, rule-separated readout band for the data workspace.
 * It owns no surface: the card is the only group material, and the band
 * establishes hierarchy through one headline, a small ledger and hairline
 * rules. The single accent is the meter on a real 0-100 measurement.
 */
export default function StatisticsSummary({
  ariaLabel,
  primary,
  stats,
  meta,
  className = '',
}: StatisticsSummaryProps) {
  const meter = primary.meter === undefined
    ? null
    : Math.min(Math.max(primary.meter, 0), 100)

  return (
    <section className={`data-readout ${className}`.trim()} aria-label={ariaLabel}>
      <div className="data-readout-grid">
        <div className="data-readout-primary">
          <p className="data-readout-label">{primary.label}</p>
          <p className="data-readout-value is-primary">
            <span className="data-readout-number">{primary.value}</span>
            {primary.unit && <span className="data-readout-unit">{primary.unit}</span>}
          </p>
          {meter !== null && (
            <div
              className="data-readout-meter"
              role="progressbar"
              aria-label={primary.meterLabel ?? `${primary.label}进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meter}
              aria-valuetext={primary.meterText}
            >
              <span style={{ width: `${meter}%` }} />
            </div>
          )}
          {primary.detail && (
            <p className="data-readout-detail">{primary.detail}</p>
          )}
        </div>

        <dl className="data-readout-stats" data-count={stats.length}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={`data-readout-stat${stat.muted ? ' is-muted' : ''}`}
            >
              <dt className="data-readout-label">{stat.label}</dt>
              <dd className="data-readout-value">
                <span className="data-readout-number">{stat.value}</span>
                {stat.unit && <span className="data-readout-unit">{stat.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {meta && meta.length > 0 && (
        <div className="data-readout-meta">
          {meta.map((item, index) => (
            <span key={`${item.label ?? 'meta'}-${index}`}>
              {item.label && <span className="data-readout-meta-label">{item.label}</span>}
              {item.label ? ' ' : null}
              {item.value}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
