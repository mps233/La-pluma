import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'

interface DropTrendPoint {
  name: string
  count: number
}

interface DropTrendChartProps {
  data: DropTrendPoint[]
}

export default function DropTrendChart({ data }: DropTrendChartProps) {
  return (
    <div className="drop-records-chart-canvas">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <ChartTooltip
            contentStyle={{
              background: 'var(--app-surface)',
              border: '1px solid var(--app-border)',
              borderRadius: 'var(--app-radius-md)',
              color: 'var(--app-text-primary)',
            }}
          />
          <Bar dataKey="count" name="掉落数量" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
