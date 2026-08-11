import { Lock } from 'lucide-react'

// Shown inline (not full-page) when the person has access to a module/page —
// so they can see what it does and how it works — but hasn't been granted
// the "view" permission for its data yet. Keeps the rest of the page (forms,
// buttons, layout) visible so they can see the feature; only the data/list
// itself is replaced by this notice.
export default function PermissionNotice({ label = 'existing data' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--track-bg)', border: '1px dashed var(--border)', borderRadius: 14,
      padding: '14px 16px', margin: '12px 0', color: 'var(--text-secondary)', fontSize: 13,
    }}>
      <Lock size={16} style={{ flexShrink: 0 }} />
      <span>You don't have permission to view {label} yet. Ask your admin to grant you view access.</span>
    </div>
  )
}
