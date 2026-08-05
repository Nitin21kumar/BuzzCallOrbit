import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { ArrowUp, ArrowDown } from 'lucide-react'

export default function StatCard({ label, value, icon: Icon, tint, trendData, trendColor, trendPct }) {
  const colors = {
    purple: '#7C5CFC',
    success: '#22C55E',
    danger: '#F04438',
    blue: '#3B82F6',
  }
  const iconColor = colors[tint] || colors.purple
  const chartData = (trendData || []).map((v, i) => ({ i, v }))
  const hasTrend = chartData.length > 1 && chartData.some((d) => d.v > 0)
  const gradId = `grad-${label.replace(/\s/g, '')}`

  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className={`stat-icon-badge stat-icon-badge--${tint || 'purple'}`}>
          <Icon size={19} color="#fff" strokeWidth={2} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="stat-card-label">{label}</div>
          <div className="stat-card-value">{value}</div>
        </div>
      </div>
      {trendPct !== undefined && trendPct !== null && (
        <div className="stat-card-trend" style={{ color: trendPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {trendPct >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          <span style={{ fontWeight: 700 }}>{Math.abs(trendPct)}%</span>
          <span className="stat-card-trend-sub">vs last week</span>
        </div>
      )}
      {hasTrend ? (
        <div style={{ height: 30, marginTop: 6, marginLeft: -4, marginRight: -4 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor || iconColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={trendColor || iconColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={trendColor || iconColor} strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive animationDuration={900} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <div style={{ height: 4 }} />}
    </div>
  )
}
