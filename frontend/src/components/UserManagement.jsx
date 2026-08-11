import { useEffect, useMemo, useState } from 'react'
import {
  Check, ChevronDown, Copy, KeyRound, Pencil, Shield, ShieldCheck,
  Trash2, UserCheck, UserPlus, UserX, X,
} from 'lucide-react'
import { toast } from 'sonner'
import * as api from '../api'
import { usePermissions } from '../permissions.jsx'

const ROLE_LABEL = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' }
const ROLE_TONE = { super_admin: 'violet', admin: 'blue', user: 'default' }

export default function UserManagement() {
  const { profile, catalog } = usePermissions()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState(null) // null = creating new

  const assignableRoles = catalog?.assignable_roles?.[profile.role] || []

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.listUsers()
      setUsers(res.data)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setEditingUser(null); setShowForm(true) }
  const openEdit = (u) => { setEditingUser(u); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditingUser(null) }

  const handleToggleActive = async (u) => {
    try {
      await api.updateUser(u.uid, { active: !u.active })
      toast.success(u.active ? `${u.name} deactivated` : `${u.name} activated`)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Update failed')
    }
  }

  const handleDelete = async (u) => {
    if (!window.confirm(`Permanently delete ${u.name} (${u.email})? This cannot be undone.`)) return
    try {
      await api.deleteUser(u.uid)
      toast.success(`${u.name} deleted`)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Delete failed')
    }
  }

  return (
    <div className="users-page">
      <div className="dash-header-row">
        <div>
          <h1 className="dash-title">User Management</h1>
          <p className="dash-sub">Create users and control exactly which modules, actions, and fields they can access.</p>
        </div>
        {assignableRoles.length > 0 && (
          <button className="dash-btn dash-btn--primary" onClick={openCreate}>
            <UserPlus size={15} /> New User
          </button>
        )}
      </div>

      <div className="dash-card users-table-card">
        {loading ? (
          <p className="empty-text">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="empty-text">No users yet.</p>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th className="dash-th">User</th>
                <th className="dash-th">Role</th>
                <th className="dash-th">Modules</th>
                <th className="dash-th">Status</th>
                <th className="dash-th" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const canManage = assignableRoles.includes(u.role) && u.uid !== profile.uid
                return (
                  <tr key={u.uid} className="dash-tr">
                    <td className="dash-td">
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{u.email}</div>
                    </td>
                    <td className="dash-td">
                      <span className={`role-badge role-badge--${ROLE_TONE[u.role]}`}>
                        {u.role === 'super_admin' ? <ShieldCheck size={11} /> : u.role === 'admin' ? <Shield size={11} /> : null}
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="dash-td">
                      {u.role === 'super_admin' || u.role === 'admin' ? (
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>All modules</span>
                      ) : u.modules.length === 0 ? (
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>None assigned</span>
                      ) : (
                        <div className="users-module-chips">
                          {u.modules.map((m) => (
                            <span key={m} className="module-chip">{catalog?.modules?.find((c) => c.key === m)?.label || m}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="dash-td">
                      <span className="status-badge" style={{
                        background: u.active ? 'var(--success-soft)' : 'var(--danger-soft)',
                        color: u.active ? 'var(--success)' : 'var(--danger)',
                      }}>{u.active ? 'Active' : 'Deactivated'}</span>
                    </td>
                    <td className="dash-td" style={{ textAlign: 'right' }}>
                      {canManage && (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="icon-action-btn" title="Edit" onClick={() => openEdit(u)}><Pencil size={13} /></button>
                          <button className="icon-action-btn" title={u.active ? 'Deactivate' : 'Activate'} onClick={() => handleToggleActive(u)}>
                            {u.active ? <UserX size={13} /> : <UserCheck size={13} />}
                          </button>
                          <button className="icon-action-btn icon-action-btn--danger" title="Delete" onClick={() => handleDelete(u)}><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <UserFormModal
          key={editingUser?.uid || 'new'}
          user={editingUser}
          catalog={catalog}
          assignableRoles={assignableRoles}
          onClose={closeForm}
          onSaved={() => { closeForm(); load() }}
        />
      )}
    </div>
  )
}

function UserFormModal({ user, catalog, assignableRoles, onClose, onSaved }) {
  const isEditing = !!user
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState(user?.role || assignableRoles[0] || 'user')
  const [modules, setModules] = useState(new Set(user?.modules || []))
  const [services, setServices] = useState(new Set(user?.services || []))
  const [fields, setFields] = useState(new Set(user?.fields || []))
  const [saving, setSaving] = useState(false)
  const [resetLink, setResetLink] = useState(null)

  const needsGranularAccess = role === 'user'

  const toggleModule = (modKey, modConfig) => {
    setModules((prev) => {
      const next = new Set(prev)
      if (next.has(modKey)) {
        next.delete(modKey)
        setServices((s) => { const ns = new Set(s); modConfig.services.forEach((svc) => ns.delete(svc.key)); return ns })
        setFields((f) => { const nf = new Set(f); modConfig.fields.forEach((fl) => nf.delete(fl.key)); return nf })
      } else {
        next.add(modKey)
      }
      return next
    })
  }
  const toggleService = (key) => setServices((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const toggleField = (key) => setFields((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      name: name.trim(),
      role,
      modules: needsGranularAccess ? Array.from(modules) : [],
      services: needsGranularAccess ? Array.from(services) : [],
      fields: needsGranularAccess ? Array.from(fields) : [],
    }
    try {
      if (isEditing) {
        await api.updateUser(user.uid, payload)
        toast.success('User updated')
        onSaved()
      } else {
        const res = await api.createUser({ ...payload, email: email.trim() })
        toast.success('User created')
        if (res.data?.password_reset_link) {
          setResetLink(res.data.password_reset_link)
        } else {
          onSaved()
        }
      }
    } catch (e2) {
      toast.error(e2?.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(resetLink)
    toast.success('Link copied — share it with the new user to set their password')
  }

  if (resetLink) {
    return (
      <div className="welcome-modal-overlay" onClick={onSaved}>
        <div className="welcome-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
          <button className="welcome-modal-close" onClick={onSaved} aria-label="Close"><X size={16} /></button>
          <div className="welcome-modal-icon"><KeyRound size={24} color="#fff" /></div>
          <h2 className="welcome-modal-title">User created</h2>
          <p className="welcome-modal-sub">Share this one-time link with them so they can set their own password.</p>
          <div className="reset-link-box">{resetLink}</div>
          <button className="welcome-modal-btn" onClick={copyLink}><Copy size={14} style={{ marginRight: 6 }} />Copy link</button>
        </div>
      </div>
    )
  }

  return (
    <div className="welcome-modal-overlay" onClick={onClose}>
      <form className="user-form-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button type="button" className="welcome-modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h2 className="auth-title" style={{ textAlign: 'left', fontSize: 20 }}>{isEditing ? 'Edit user' : 'Create user'}</h2>

        <div className="user-form-scroll">
          <label className="auth-field-label">
            Full name
            <input required className="auth-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter full name" />
          </label>

          {!isEditing && (
            <label className="auth-field-label">
              Email address
              <input required type="email" className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" />
            </label>
          )}

          <label className="auth-field-label">
            Role
            <div className="role-select-row">
              {assignableRoles.map((r) => (
                <button
                  type="button" key={r}
                  className={`role-option${role === r ? ' role-option--selected' : ''}`}
                  onClick={() => setRole(r)}
                >
                  {role === r && <Check size={12} />} {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </label>

          {needsGranularAccess && (
            <div className="permission-tree">
              <div className="auth-field-label" style={{ marginBottom: 4 }}>Modules, actions &amp; fields</div>
              {catalog?.modules?.map((mod) => (
                <div key={mod.key} className="permission-module">
                  <label className="permission-module-header">
                    <input type="checkbox" checked={modules.has(mod.key)} onChange={() => toggleModule(mod.key, mod)} />
                    <span>{mod.label}</span>
                  </label>
                  {modules.has(mod.key) && (mod.services.length > 0 || mod.fields.length > 0) && (
                    <div className="permission-sub-grid">
                      {mod.services.map((svc) => (
                        <label key={svc.key} className="permission-sub-item">
                          <input type="checkbox" checked={services.has(svc.key)} onChange={() => toggleService(svc.key)} />
                          <span>{svc.label}</span>
                        </label>
                      ))}
                      {mod.fields.map((f) => (
                        <label key={f.key} className="permission-sub-item permission-sub-item--field">
                          <input type="checkbox" checked={fields.has(f.key)} onChange={() => toggleField(f.key)} />
                          <span>Field: {f.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!needsGranularAccess && (
            <p className="empty-text" style={{ padding: '8px 0' }}>
              {ROLE_LABEL[role]} automatically gets access to every module, action, and field.
            </p>
          )}
        </div>

        <button className="auth-submit-btn" disabled={saving} style={{ marginTop: 18 }}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create user'}
        </button>
      </form>
    </div>
  )
}
