import { useState, useEffect } from 'react'
import { Home, Phone, PhoneCall, PhoneOff, Satellite, RefreshCw, PlusCircle } from 'lucide-react'
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import StatCard from './StatCard'
import AudioPlayerWidget from './AudioPlayerWidget.jsx'
import WelcomeModal from './WelcomeModal.jsx'
import * as api from '../api'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  // Area + Line both plot the same "total" series (one for the fill, one for the stroke/dots) —
  // dedupe by dataKey so "Total Calls" doesn't show up twice in the tooltip.
  const seen = new Set()
  const rows = payload.filter((p) => {
    if (seen.has(p.dataKey)) return false
    seen.add(p.dataKey)
    return true
  })
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{new Date(label).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.color }} />
          <span className="chart-tooltip-label">{p.name}</span>
          <span className="chart-tooltip-value">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ user, onCreateCampaign, onOpenCampaigns, searchQuery }) {
  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [dailyStats, setDailyStats] = useState([])
  const [topCampaigns, setTopCampaigns] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [noViewAccess, setNoViewAccess] = useState(false)

  const displayName = user?.displayName?.trim() || (user?.email ? user.email.split('@')[0] : 'there')

  // Shown once per browser session, right when the dashboard first loads after
  // sign-in — not every time the user switches back to this tab.
  const [showWelcome, setShowWelcome] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage.getItem('obd-welcome-shown') !== 'true'
  )
  const dismissWelcome = () => {
    setShowWelcome(false)
    window.sessionStorage.setItem('obd-welcome-shown', 'true')
  }

  const load = async () => {
    try {
      const [overviewRes, campaignsRes, dailyRes, perfRes] = await Promise.all([
        api.getObdOverview(), api.listCampaigns(), api.getDailyStats(), api.getCampaignPerformance(),
      ])
      setOverview(overviewRes.data)
      setCampaigns(campaignsRes.data)
      setDailyStats(dailyRes.data)
      setTopCampaigns(perfRes.data)
    } catch (error) {
      if (error?.response?.status === 403) {
        setNoViewAccess(true)
      } else {
        throw error
      }
    }
  }

  useEffect(() => { load() }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const successRate = overview?.success_rate ?? 0
  const failRate = overview && overview.total_calls ? Math.round((overview.failed / overview.total_calls) * 1000) / 10 : 0

  const q = (searchQuery || '').trim().toLowerCase()
  const isSearching = q.length > 0
  const filteredCampaigns = isSearching ? campaigns.filter((c) => c.name?.toLowerCase().includes(q)) : campaigns
  const filteredTopCampaigns = isSearching ? topCampaigns.filter((c) => c.name?.toLowerCase().includes(q)) : topCampaigns
  const filteredActivity = isSearching
    ? (overview?.recent_activity ?? []).filter((a) => a.campaign_name?.toLowerCase().includes(q))
    : (overview?.recent_activity ?? [])

  const trendPct = (key) => {
    if (!dailyStats || dailyStats.length < 2) return null
    const mid = Math.ceil(dailyStats.length / 2)
    const firstHalf = dailyStats.slice(0, mid)
    const secondHalf = dailyStats.slice(mid)
    const avg = (arr) => arr.reduce((s, d) => s + (d[key] || 0), 0) / (arr.length || 1)
    const a = avg(firstHalf), b = avg(secondHalf)
    if (a === 0) return b > 0 ? 100 : 0
    return Math.round(((b - a) / a) * 1000) / 10
  }

  return (
    <div className="dash-page">
      {showWelcome && <WelcomeModal name={displayName} onClose={dismissWelcome} />}

      <div className="dash-header-row">
        <div>
          <h1 className="dash-title">Welcome back, {displayName} 👋</h1>
          <p className="dash-sub">
            {noViewAccess
              ? "You don't have permission to view dashboard data yet. Ask your admin for access."
              : "Here's what's happening with your calling campaigns today."}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="dash-btn dash-btn--ghost" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
          </button>
          <button className="dash-btn dash-btn--primary" onClick={onCreateCampaign}><PlusCircle size={15} /> New Campaign</button>
        </div>
      </div>

      <div className="dash-stats-row">
        <StatCard label="Total Calls" value={overview?.total_calls ?? 0} icon={Home} tint="purple" trendData={dailyStats.map(d => d.total)} trendColor="#7C5CFC" trendPct={trendPct('total')} />
        <StatCard label="Successful Calls" value={overview?.completed ?? 0} icon={Phone} tint="success" trendData={dailyStats.map(d => d.completed)} trendColor="#22C55E" trendPct={trendPct('completed')} />
        <StatCard label="Failed Calls" value={overview?.failed ?? 0} icon={PhoneOff} tint="danger" trendData={dailyStats.map(d => d.failed)} trendColor="#F04438" trendPct={trendPct('failed') !== null ? -Math.abs(trendPct('failed')) : null} />
        <StatCard label="Running Campaigns" value={overview?.running_campaigns ?? 0} icon={Satellite} tint="blue" />
      </div>

      <div className="dash-row3">
        <div className="dash-card dash-card--fill">
          <div className="dash-card-header-row">
            <h3 className="dash-card-title">Call Analytics (Total, Successful, Failed, Daily)</h3>
          </div>
          <div className="card-fill-body card-fill-body--chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyStats}>
                <defs>
                  <linearGradient id="totalCallsFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C5CFC" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#7C5CFC" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="total" name="Total Calls" stroke="none" fill="url(#totalCallsFade)" fillOpacity={1} isAnimationActive animationDuration={900} />
                <Bar dataKey="completed" name="Successful Calls" fill="#22C55E" radius={[3, 3, 0, 0]} barSize={10} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                <Bar dataKey="failed" name="Failed Calls" fill="#F04438" radius={[3, 3, 0, 0]} barSize={10} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                <Line type="monotone" dataKey="total" name="Total Calls" stroke="#7C5CFC" strokeWidth={2} dot={{ r: 2.5, fill: '#7C5CFC' }} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dash-card dash-card--fill success-card">
          <h3 className="dash-card-title">Call Success Rate</h3>
          <div className="success-ring-wrap">
            <div style={{ position: 'relative', height: 100, display: 'flex', justifyContent: 'center' }}>
              <svg viewBox="0 0 120 120" style={{ height: '100%', width: 'auto' }}>
                <defs>
                  <linearGradient id="successRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#A78BFA" />
                    <stop offset="50%" stopColor="#14B8A6" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
                {/* Outer track circle */}
                <circle cx="60" cy="60" r="50" fill="none" stroke="#EDEBFF" strokeWidth="13" />
                {/* Gradient progress arc — only draw it once there's an actual rate, otherwise the round line-cap renders as a stray dot at 0% */}
                {successRate > 0 && (
                  <circle
                    className="success-ring-arc"
                    cx="60" cy="60" r="50" fill="none" stroke="url(#successRingGradient)" strokeWidth="13"
                    strokeLinecap="round" strokeDasharray={`${(successRate / 100) * 2 * Math.PI * 50} ${2 * Math.PI * 50}`}
                    transform="rotate(-90 60 60)"
                  />
                )}
              </svg>
              <div className="success-ring-center">
                <div style={{ fontSize: 17, fontWeight: 800 }}>{successRate}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Success Rate</div>
              </div>
            </div>
          </div>
          <div className="success-legend">
            <div className="legend-row">
              <span className="legend-dot" style={{ background: '#14B8A6' }} />
              <span className="legend-label">Successful Calls</span>
              <span className="legend-value">{overview?.completed ?? 0} ({successRate}%)</span>
            </div>
            <div className="legend-row">
              <span className="legend-dot" style={{ background: '#7C5CFC' }} />
              <span className="legend-label">Failed Calls</span>
              <span className="legend-value">{overview?.failed ?? 0} ({failRate}%)</span>
            </div>
          </div>
        </div>

        <div className="dash-card dash-card--fill">
          <div className="dash-card-header-row">
            <h3 className="dash-card-title">Recent Campaign Activity</h3>
            <button onClick={onOpenCampaigns} className="view-all-link">View All</button>
          </div>
          <div className="card-fill-body activity-list">
            {isSearching && filteredActivity.length === 0 && <p className="empty-text">No activity found for "{searchQuery}".</p>}
            {!isSearching && (overview?.recent_activity?.length ?? 0) === 0 && <p className="empty-text">No calls triggered yet.</p>}
            {filteredActivity.slice(0, 5).map((entry, index) => {
              const ok = entry.status === 'completed'
              const bad = ['failed', 'busy', 'no-answer', 'canceled', 'skipped'].includes(entry.status)
              return (
                <div key={index} className="activity-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span className="activity-icon" style={{ background: ok ? 'var(--success-soft)' : bad ? 'var(--danger-soft)' : 'var(--warning-soft)', color: ok ? 'var(--success)' : bad ? 'var(--danger)' : 'var(--warning)' }}>
                      <PhoneCall size={12} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="activity-title">Campaign: {entry.campaign_name}</div>
                      <div className="activity-sub">Call to {entry.phone_number}</div>
                    </div>
                  </div>
                  <span className="status-badge" style={{ background: ok ? 'var(--success-soft)' : bad ? 'var(--danger-soft)' : 'var(--warning-soft)', color: ok ? 'var(--success)' : bad ? 'var(--danger)' : 'var(--warning)' }}>
                    {ok ? 'Success' : bad ? 'Failed' : entry.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="dash-row3b">
        <div className="dash-card dash-card--fill">
          <div className="dash-card-header-row">
            <h3 className="dash-card-title">Recent Campaigns</h3>
            <button onClick={onOpenCampaigns} className="view-all-link">View All Campaigns →</button>
          </div>
          <div className="card-fill-body card-fill-body--center">
          <table className="dash-table">
            <thead>
              <tr>
                <th className="dash-th">Campaign Name</th>
                <th className="dash-th">Status</th>
                <th className="dash-th">Success Rate</th>
                <th className="dash-th">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.slice(0, 5).map((c) => {
                const perf = topCampaigns.find((t) => t.id === c.id)
                return (
                  <tr key={c.id} className="dash-tr">
                    <td className="dash-td">{c.name}</td>
                    <td className="dash-td">
                      <span className="status-badge" style={{
                        background: c.status === 'completed' ? 'var(--success-soft)' : c.status === 'running' ? 'var(--warning-soft)' : '#F1F2F6',
                        color: c.status === 'completed' ? 'var(--success)' : c.status === 'running' ? 'var(--warning)' : '#6B7280',
                      }}>{c.status}</span>
                    </td>
                    <td className="dash-td">
                      {perf ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="progress-track" style={{ width: 55 }}><div className="progress-fill" style={{ width: `${perf.success_rate}%` }} /></div>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{perf.success_rate}%</span>
                        </div>
                      ) : <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>—</span>}
                    </td>
                    <td className="dash-td" style={{ color: 'var(--text-secondary)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                )
              })}
              {filteredCampaigns.length === 0 && (
                <tr><td colSpan={4} className="dash-td" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {isSearching ? `No campaigns found for "${searchQuery}".` : 'No campaigns yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="dash-card dash-card--fill">
          <div className="dash-card-header-row">
            <h3 className="dash-card-title">Top Performing Campaigns</h3>
          </div>
          <div className="card-fill-body card-fill-body--center">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isSearching && filteredTopCampaigns.length === 0 && <p className="empty-text">No campaigns found for "{searchQuery}".</p>}
            {!isSearching && topCampaigns.length === 0 && <p className="empty-text">No campaign calls yet.</p>}
            {filteredTopCampaigns.slice(0, 5).map((c, i) => (
              <div key={c.id}>
                <div className="rank-row">
                  <span className="rank-num">{i + 1}. {c.name}</span>
                  <span className="rank-pct">{c.success_rate}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${c.success_rate}%` }} />
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>

        <AudioPlayerWidget />
      </div>
    </div>
  )
}
