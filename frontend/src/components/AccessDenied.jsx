import { ShieldAlert, RefreshCw } from 'lucide-react'

export default function AccessDenied({ moduleLabel, onLogout, onRefresh }) {
  return (
    <div className="access-denied">
      <div className="access-denied-icon"><ShieldAlert size={26} color="#fff" /></div>
      <h2>Access restricted</h2>
      <p>You don't have permission to view {moduleLabel || 'this section'}. Ask your admin to grant you access.</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {onRefresh && (
          <button className="dash-btn" onClick={onRefresh}>
            <RefreshCw size={13} /> Refresh
          </button>
        )}
        {onLogout && (
          <button className="dash-btn dash-btn--primary" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
