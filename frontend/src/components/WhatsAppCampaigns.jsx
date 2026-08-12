import { useState, useEffect } from 'react'
import { MessageCircle, FileSpreadsheet, Loader2, Download, RefreshCw, ArrowLeft, Trash2, Send, Inbox, Eye, BookOpen, Tags, UserCheck, Plus } from 'lucide-react'
import * as api from '../api'
import { LANGUAGES } from '../languages'
import PermissionNotice from './PermissionNotice.jsx'

export default function WhatsAppCampaigns() {
  const [tab, setTab] = useState('campaigns') // campaigns | inbox | templates | ai
  const [campaigns, setCampaigns] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [view, setView] = useState('list') // list | create | detail
  const [noViewAccess, setNoViewAccess] = useState(false)

  const [name, setName] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateLanguage, setTemplateLanguage] = useState('')
  const [availableTemplates, setAvailableTemplates] = useState([])
  const [templatesError, setTemplatesError] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploadingContacts, setUploadingContacts] = useState(false)
  const [deletingContacts, setDeletingContacts] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [starting, setStarting] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [status, setStatus] = useState(null)

  const activeCampaign = campaigns.find((c) => c.id === activeId) || null
  const launched = activeCampaign ? activeCampaign.status !== 'draft' : false

  const loadCampaigns = async () => {
    try {
      const res = await api.listWhatsAppCampaigns()
      setCampaigns(res.data)
      return res.data
    } catch (error) {
      if (error?.response?.status === 403) { setNoViewAccess(true); return [] }
      throw error
    }
  }

  useEffect(() => { loadCampaigns() }, [])

  const loadAvailableTemplates = async () => {
    setTemplatesError('')
    try {
      const res = await api.listWhatsAppTemplates()
      setAvailableTemplates(res.data)
    } catch (error) {
      setTemplatesError(error.response?.data?.detail || 'Failed to load templates')
    }
  }

  useEffect(() => { if (view === 'create') loadAvailableTemplates() }, [view])

  const uniqueTemplateNames = [...new Set(availableTemplates.map((t) => t.name))]
  const languagesForSelectedTemplate = availableTemplates.filter((t) => t.name === templateName)

  const refreshStatus = async () => {
    if (!activeId) return
    const res = await api.getWhatsAppCampaignStatus(activeId)
    setStatus(res.data)
  }

  useEffect(() => { if (activeId) refreshStatus() }, [activeId])
  useEffect(() => {
    if (status?.campaign_status !== 'running') return
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [status, activeId])

  const handleCreate = async () => {
    if (!name.trim()) return alert('Enter a campaign name')
    if (!templateName.trim()) return alert('Select a template')
    if (!templateLanguage.trim()) return alert('Select the template language')
    setCreating(true)
    try {
      const res = await api.createWhatsAppCampaign(name.trim(), templateName.trim(), templateLanguage.trim(), '', '', 'en-IN')
      setName(''); setTemplateName(''); setTemplateLanguage('')
      await loadCampaigns()
      setActiveId(res.data.id)
      setStatus(null)
      setView('detail')
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id, campaignName) => {
    if (!confirm(`Permanently delete "${campaignName}"? Its contacts will be deleted too.`)) return
    setDeletingId(id)
    try {
      await api.deleteWhatsAppCampaign(id)
      if (activeId === id) { setActiveId(null); setStatus(null); setView('list') }
      await loadCampaigns()
    } finally {
      setDeletingId(null)
    }
  }

  const handleUploadContacts = async (file) => {
    setUploadingContacts(true)
    try {
      const res = await api.uploadWhatsAppContacts(activeId, file)
      alert(res.data.message)
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to upload contact sheet')
    } finally {
      setUploadingContacts(false)
    }
  }

  const handleDeleteContacts = async () => {
    if (!confirm('Remove all uploaded contacts?')) return
    setDeletingContacts(true)
    try { await api.deleteWhatsAppContacts(activeId) } finally { setDeletingContacts(false) }
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await api.startWhatsAppCampaign(activeId)
      alert(res.data.message)
      await loadCampaigns()
      await refreshStatus()
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to start campaign')
    } finally {
      setStarting(false)
    }
  }

  const handleDownloadReport = async (campaignId) => {
    setDownloadingReport(true)
    try {
      await api.downloadWhatsAppReport(campaignId)
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not download the report')
    } finally {
      setDownloadingReport(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ ...styles.headerRow, flexShrink: 0 }}>
        <div>
          <h1 style={styles.title}><MessageCircle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />WhatsApp</h1>
          <p style={styles.sub}>Broadcast approved templates and let AI-powered auto-replies handle incoming messages.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...styles.refreshBtn, ...(tab === 'campaigns' ? styles.toggleBtnActive : {}) }} onClick={() => setTab('campaigns')}>Campaigns</button>
          <button style={{ ...styles.refreshBtn, ...(tab === 'templates' ? styles.toggleBtnActive : {}) }} onClick={() => setTab('templates')}>Templates</button>
          <button style={{ ...styles.refreshBtn, ...(tab === 'ai' ? styles.toggleBtnActive : {}) }} onClick={() => setTab('ai')}>AI & Rules</button>
          <button style={{ ...styles.refreshBtn, ...(tab === 'inbox' ? styles.toggleBtnActive : {}) }} onClick={() => setTab('inbox')}><Inbox size={13} /> Conversations</button>
        </div>
      </div>

      {/* Only this area scrolls — the title/tabs/button row above stays put,
          same idea as the Dashboard's "flush" layout so the page never
          scrolls out from under the sidebar/header when a list has a lot
          of rows. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 16 }}>
      {tab === 'ai' ? <WhatsAppAISettings /> : tab === 'templates' ? <WhatsAppTemplates /> : tab === 'inbox' ? <WhatsAppInbox /> : (
        <>
          {view === 'create' && (
            <div style={{ ...styles.card, maxWidth: 480, margin: '0 auto 24px' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>New WhatsApp Campaign</h3>
              <label style={styles.label}>Campaign Name</label>
              <input style={styles.select} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali Offer Broadcast" />

              {templatesError && <p style={{ ...styles.hint, color: 'var(--danger)' }}>{templatesError} — <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={loadAvailableTemplates}>Retry</span></p>}

              <label style={styles.label}>Template</label>
              <select style={styles.select} value={templateName} onChange={(e) => { setTemplateName(e.target.value); setTemplateLanguage('') }}>
                <option value="" disabled>Select a template…</option>
                {uniqueTemplateNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {availableTemplates.length === 0 && !templatesError && <p style={styles.hint}>Loading templates… (if none show up, create one in the 'Templates' tab first)</p>}

              <label style={styles.label}>Language</label>
              <select style={styles.select} value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} disabled={!templateName}>
                <option value="" disabled>Select a language…</option>
                {languagesForSelectedTemplate.map((t) => <option key={t.language} value={t.language}>{t.language} — {t.status}</option>)}
              </select>
              {templateName && languagesForSelectedTemplate.some((t) => t.status !== 'APPROVED') && (
                <p style={{ ...styles.hint, color: 'var(--warning)' }}>⚠️ Some languages aren't Approved yet — only 'APPROVED' status ones can be sent.</p>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button style={styles.primaryBtnSmall} onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create Campaign'}</button>
                <button style={styles.refreshBtn} onClick={() => setView('list')}>Cancel</button>
              </div>
            </div>
          )}

          {view === 'detail' && activeCampaign ? (
            <div>
              <button style={styles.backBtn} onClick={() => { setView('list'); setActiveId(null); setStatus(null); loadCampaigns() }}>
                <ArrowLeft size={15} /> All WhatsApp Campaigns
              </button>
              <div style={styles.headerRow}>
                <div>
                  <h1 style={styles.title}>{activeCampaign.name}</h1>
                  <p style={styles.sub}>Template: <b>{activeCampaign.template_name}</b> ({activeCampaign.template_language}) · Status: {activeCampaign.status}</p>
                  {activeCampaign.message_text && <p style={styles.sub}>Message: "{activeCampaign.message_text}" ({LANGUAGES.find(l => l.code === activeCampaign.source_language_code)?.name || activeCampaign.source_language_code})</p>}
                </div>
                <button style={styles.refreshBtn} onClick={refreshStatus}><RefreshCw size={14} /> Refresh</button>
              </div>

              <div style={styles.grid}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...(launched ? styles.fadedSection : {}) }}>
                  <div style={styles.card}>
                    <div style={styles.stepLabel}><FileSpreadsheet size={15} /> Step 1 — Contacts</div>
                    <input disabled={launched} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadContacts(f); e.target.value = '' }} style={{ marginTop: 10 }} />
                    <p style={styles.hint}>Columns: <b>Phone Number</b> (required), <b>Name</b> (optional), <b>Language</b> (e.g. "Hindi", "Bengali" — the message is auto-translated into that language), or <b>Var1, Var2...</b> (raw template placeholders, no translation).</p>
                    {uploadingContacts && <p style={styles.hint}>Uploading…</p>}
                    {!launched && (
                      <button onClick={handleDeleteContacts} disabled={deletingContacts} style={{ ...styles.deleteContactsBtn, marginTop: 8 }}>
                        <Trash2 size={13} /> {deletingContacts ? 'Deleting…' : 'Clear contacts'}
                      </button>
                    )}
                  </div>

                  <div style={styles.card}>
                    <div style={styles.stepLabel}><Send size={15} /> Step 2 — Launch</div>
                    <button onClick={handleStart} disabled={launched || starting} style={styles.primaryBtn}>
                      {starting ? 'Starting…' : launched ? '🔒 Already launched' : '🚀 Send broadcast to all contacts'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {status ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={styles.miniStat}><span style={styles.miniLabel}>Total Contacts</span><div style={styles.miniValue}>{status.total_contacts}</div></div>
                        <div style={styles.miniStat}><span style={styles.miniLabel}>Sent</span><div style={{ ...styles.miniValue, color: 'var(--success)' }}>{status.sent}</div></div>
                        <div style={styles.miniStat}><span style={styles.miniLabel}>Failed</span><div style={{ ...styles.miniValue, color: 'var(--danger)' }}>{status.failed}</div></div>
                        <div style={styles.miniStat}><span style={styles.miniLabel}>Queued</span><div style={{ ...styles.miniValue, color: 'var(--warning)' }}>{status.queued}</div></div>
                      </div>
                      <button style={styles.downloadBtn} onClick={() => handleDownloadReport(activeCampaign.id)} disabled={downloadingReport}>
                        <Download size={16} /> {downloadingReport ? 'Downloading…' : 'Download Excel report'}
                      </button>
                    </>
                  ) : <div style={styles.emptyCard}><MessageCircle size={22} color="var(--text-secondary)" /><p style={styles.hint}>Loading status…</p></div>}
                </div>
              </div>
            </div>
          ) : view === 'list' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button style={styles.newBtn} onClick={() => setView('create')}><MessageCircle size={16} /> New WhatsApp Campaign</button>
              </div>
              <div style={styles.card}>
                {noViewAccess ? (
                  <PermissionNotice label="the WhatsApp campaigns list" />
                ) : (
                <table style={styles.table}>
                  <thead>
                    <tr><th style={styles.th}>Campaign</th><th style={styles.th}>Template</th><th style={styles.th}>Status</th><th style={{ ...styles.th, textAlign: 'right' }}>Actions</th></tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} style={styles.tr}>
                        <td style={styles.td}>{c.name}</td>
                        <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{c.template_name} ({c.template_language})</td>
                        <td style={styles.td}>
                          <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: c.status === 'completed' ? 'var(--success-soft)' : c.status === 'running' ? 'var(--warning-soft)' : '#F1F2F6', color: c.status === 'completed' ? 'var(--success)' : c.status === 'running' ? 'var(--warning)' : '#6B7280' }}>{c.status}</span>
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>
                          <button onClick={() => { setActiveId(c.id); setStatus(null); setView('detail') }} style={styles.actionBtn}><Eye size={13} /> View</button>
                          <button onClick={() => handleDelete(c.id, c.name)} disabled={deletingId === c.id} style={{ ...styles.actionBtn, ...styles.deleteCampaignBtn, marginLeft: 8 }}>
                            <Trash2 size={13} /> {deletingId === c.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {campaigns.length === 0 && <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '30px 0' }}>No WhatsApp campaigns yet — create one.</td></tr>}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  )
}

function WhatsAppTemplates() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('MARKETING')
  const [languageCode, setLanguageCode] = useState('en_US')
  const [bodyExample, setBodyExample] = useState('')
  const [staticPrefix, setStaticPrefix] = useState('')
  const [staticSuffix, setStaticSuffix] = useState('')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState('')
  const [noViewAccess, setNoViewAccess] = useState(false)

  const loadTemplates = async () => {
    setLoading(true)
    setError('')
    setNoViewAccess(false)
    try {
      const res = await api.listWhatsAppTemplates()
      setTemplates(res.data)
    } catch (err) {
      if (err.response?.status === 403) setNoViewAccess(true)
      else setError(err.response?.data?.detail || 'Failed to load templates — check WHATSAPP_BUSINESS_ACCOUNT_ID in .env')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTemplates() }, [])

  const handleCreate = async () => {
    if (!name.trim()) return alert('Enter a template name')
    if (!bodyExample.trim()) return alert('Enter a sample value for {{1}} (required for Meta review)')
    setCreating(true)
    setCreateResult('')
    try {
      const res = await api.createWhatsAppTemplate(name.trim(), category, languageCode.trim(), bodyExample.trim(), staticPrefix.trim(), staticSuffix.trim())
      setCreateResult(`✅ ${res.data.message} (status: ${res.data.status})`)
      setName(''); setBodyExample('')
      await loadTemplates()
    } catch (err) {
      setCreateResult(`❌ ${err.response?.data?.detail || 'Failed to create template'}`)
    } finally {
      setCreating(false)
    }
  }

  const statusColor = (status) => {
    if (status === 'APPROVED') return { background: 'var(--success-soft)', color: 'var(--success)' }
    if (status === 'REJECTED') return { background: 'var(--danger-soft)', color: 'var(--danger)' }
    return { background: 'var(--warning-soft)', color: 'var(--warning)' }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={styles.hint}>This shows live status straight from your WhatsApp Business Account.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.refreshBtn} onClick={loadTemplates}><RefreshCw size={14} /> Refresh</button>
          <button style={styles.newBtn} onClick={() => setShowCreate((s) => !s)}>+ New Template</button>
        </div>
      </div>

      {showCreate && (
        <div style={{ ...styles.card, maxWidth: 480, marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>New Template</h3>
          <p style={styles.hint}>The body will contain a single placeholder <code>{'{{1}}'}</code> — this matches this app's per-contact-language broadcast flow. Adding fixed text before/after it (optional) improves the chances of Meta approval.</p>
          <label style={styles.label}>Template Name (lowercase, underscores)</label>
          <input style={styles.select} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. obd_broadcast_message" />
          <label style={styles.label}>Category</label>
          <select style={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utility</option>
            <option value="AUTHENTICATION">Authentication</option>
          </select>
          <label style={styles.label}>Language Code</label>
          <input style={styles.select} value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} placeholder="en_US / hi" />
          <label style={styles.label}>Fixed text BEFORE {'{{1}}'} (optional)</label>
          <input style={styles.select} value={staticPrefix} onChange={(e) => setStaticPrefix(e.target.value)} placeholder="e.g. (khaali chhod sakte ho)" />
          <label style={styles.label}>Fixed text AFTER {'{{1}}'} (optional, recommended)</label>
          <input style={styles.select} value={staticSuffix} onChange={(e) => setStaticSuffix(e.target.value)} placeholder="e.g. - Team YourCompany" />
          <label style={styles.label}>Sample value for {'{{1}}'} (Meta review ke liye — required)</label>
          <input style={styles.select} value={bodyExample} onChange={(e) => setBodyExample(e.target.value)} placeholder="e.g. Hi, your order has been confirmed" />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={styles.primaryBtnSmall} onClick={handleCreate} disabled={creating}>{creating ? 'Submitting…' : 'Submit for Review'}</button>
          </div>
          {createResult && <p style={{ ...styles.hint, marginTop: 10 }}>{createResult}</p>}
        </div>
      )}

      {error && <div style={{ ...styles.card, marginBottom: 16, color: 'var(--danger)' }}>{error}</div>}
      {noViewAccess && <PermissionNotice label="the template list" />}

      {!noViewAccess && (
      <div style={styles.card}>
        {loading ? <p style={styles.hint}>Loading…</p> : (
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Name</th><th style={styles.th}>Category</th><th style={styles.th}>Language</th><th style={styles.th}>Status</th></tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.name + t.language} style={styles.tr}>
                  <td style={styles.td}>{t.name}</td>
                  <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{t.category}</td>
                  <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{t.language}</td>
                  <td style={styles.td}>
                    <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, ...statusColor(t.status) }}>{t.status}</span>
                    {t.status === 'REJECTED' && t.rejected_reason && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{t.rejected_reason}</div>}
                  </td>
                </tr>
              ))}
              {templates.length === 0 && <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '30px 0' }}>No templates found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  )
}

function WhatsAppInbox() {
  const [conversations, setConversations] = useState([])
  const [activePhone, setActivePhone] = useState(null)
  const [messages, setMessages] = useState([])
  const [updating, setUpdating] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [noViewAccess, setNoViewAccess] = useState(false)

  const loadConversations = async () => {
    try {
      const res = await api.listWhatsAppConversations()
      setConversations(res.data)
      return true
    } catch (error) {
      if (error?.response?.status === 403) { setNoViewAccess(true); return false }
      throw error
    }
  }

  useEffect(() => {
    let timer
    loadConversations().then((ok) => {
      if (ok) timer = setInterval(loadConversations, 5000)
    })
    return () => timer && clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!activePhone) return
    const load = async () => {
      try {
        const res = await api.getWhatsAppConversation(activePhone)
        setMessages(res.data)
      } catch (error) {
        if (error?.response?.status !== 403) throw error
      }
    }
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [activePhone])

  const activeConv = conversations.find((c) => c.phone_number === activePhone)

  const statusColor = (status) => {
    if (status === 'resolved') return { background: 'var(--success-soft)', color: 'var(--success)' }
    if (status === 'pending') return { background: 'var(--warning-soft)', color: 'var(--warning)' }
    return { background: '#F1F2F6', color: 'var(--text-secondary)' }
  }

  const handleStatusChange = async (status) => {
    if (!activePhone) return
    setUpdating(true)
    try {
      await api.setConversationStatus(activePhone, status)
      await loadConversations()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not update the status')
    } finally {
      setUpdating(false)
    }
  }

  const handleHandoffToggle = async () => {
    if (!activePhone) return
    setUpdating(true)
    try {
      await api.setConversationHandoff(activePhone, !activeConv?.handoff)
      await loadConversations()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not update handoff')
    } finally {
      setUpdating(false)
    }
  }

  const handleSend = async () => {
    if (!draft.trim() || !activePhone) return
    setSending(true)
    try {
      await api.sendManualMessage(activePhone, draft.trim())
      setDraft('')
      const res = await api.getWhatsAppConversation(activePhone)
      setMessages(res.data)
      await loadConversations()
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to send message — the 24h session window may be closed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, height: 560, minHeight: 0 }}>
      <div style={{ ...styles.card, padding: noViewAccess ? 14 : 0, overflowY: 'auto', minHeight: 0 }}>
        {noViewAccess && <PermissionNotice label="conversations" />}
        {!noViewAccess && conversations.map((c) => (
          <div key={c.phone_number}
            onClick={() => setActivePhone(c.phone_number)}
            style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: activePhone === c.phone_number ? 'var(--accent-purple-soft)' : 'transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.phone_number}</span>
              <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, ...statusColor(c.status) }}>{c.status}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
              {c.last_direction === 'in' ? '' : 'You: '}{c.last_message}
            </div>
            {c.handoff && <div style={{ fontSize: 10.5, color: 'var(--warning)', fontWeight: 700, marginTop: 3 }}>🙋 Human handling this chat</div>}
          </div>
        ))}
        {!noViewAccess && conversations.length === 0 && <p style={{ ...styles.hint, padding: 14 }}>No conversations yet.</p>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {activePhone && (
          <div style={{ ...styles.card, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['open', 'pending', 'resolved'].map((s) => (
                <button key={s} disabled={updating} onClick={() => handleStatusChange(s)}
                  style={{ ...styles.actionBtn, ...(activeConv?.status === s ? { border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)' } : {}) }}>
                  {s}
                </button>
              ))}
            </div>
            <button disabled={updating} onClick={handleHandoffToggle} style={{ ...styles.actionBtn, ...(activeConv?.handoff ? { border: '1px solid var(--warning)', color: 'var(--warning)' } : {}) }}>
              <UserCheck size={13} /> {activeConv?.handoff ? 'AI Paused — Resume AI' : 'AI Auto-reply ON'}
            </button>
          </div>
        )}
        <div style={{ ...styles.card, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activePhone ? messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end',
              background: m.direction === 'in' ? '#F1F2F6' : 'var(--accent-purple)',
              color: m.direction === 'in' ? 'var(--text-primary)' : '#fff',
              padding: '9px 13px', borderRadius: 14, maxWidth: '70%', fontSize: 13.5,
            }}>
              {m.text}
            </div>
          )) : <p style={styles.hint}>Select a conversation on the left.</p>}
        </div>
        {activePhone && (
          <div style={{ ...styles.card, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, border: activeConv?.handoff ? '1.5px solid var(--warning)' : styles.card.border }}>
            {activeConv?.handoff && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)' }}>🙋 Agent mode — AI is paused, you're replying directly</span>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...styles.select, flex: 1 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !sending) handleSend() }}
                placeholder={activeConv?.handoff ? 'Type your reply as the agent…' : 'Type a message (AI is active on this chat)…'}
              />
              <button style={styles.primaryBtnSmall} onClick={handleSend} disabled={sending || !draft.trim()}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WhatsAppAISettings() {
  const [knowledgeBase, setKnowledgeBase] = useState('')
  const [savingKb, setSavingKb] = useState(false)
  const [kbSaved, setKbSaved] = useState(false)

  const [rules, setRules] = useState([])
  const [keyword, setKeyword] = useState('')
  const [replyText, setReplyText] = useState('')
  const [matchType, setMatchType] = useState('contains')
  const [addingRule, setAddingRule] = useState(false)
  const [noViewAccess, setNoViewAccess] = useState(false)

  useEffect(() => {
    api.getWhatsAppSettings().then((res) => setKnowledgeBase(res.data.knowledge_base || '')).catch((error) => {
      if (error?.response?.status !== 403) throw error
      setNoViewAccess(true)
    })
    loadRules()
  }, [])

  const loadRules = () => api.listKeywordRules().then((res) => setRules(res.data)).catch((error) => {
    if (error?.response?.status !== 403) throw error
    setNoViewAccess(true)
  })

  const handleSaveKb = async () => {
    setSavingKb(true)
    setKbSaved(false)
    try {
      await api.updateWhatsAppSettings(knowledgeBase)
      setKbSaved(true)
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not save the knowledge base')
    } finally {
      setSavingKb(false)
    }
  }

  const handleAddRule = async () => {
    if (!keyword.trim() || !replyText.trim()) return alert('Both keyword and reply text are required')
    setAddingRule(true)
    try {
      await api.createKeywordRule(keyword.trim(), replyText.trim(), matchType)
      setKeyword(''); setReplyText('')
      await loadRules()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not add this rule')
    } finally {
      setAddingRule(false)
    }
  }

  const handleDeleteRule = async (id) => {
    try {
      await api.deleteKeywordRule(id)
      await loadRules()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not delete this rule')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {noViewAccess && <PermissionNotice label="the knowledge base & keyword rules" />}
      <div style={styles.card}>
        <div style={styles.stepLabel}><BookOpen size={15} /> Business Knowledge Base</div>
        <p style={styles.hint}>Add your FAQs, policies, prices, or any other info here — the AI will answer using only this info, without inventing anything.</p>
        <textarea style={{ ...styles.select, minHeight: 140, resize: 'vertical', marginTop: 8 }} value={knowledgeBase} onChange={(e) => setKnowledgeBase(e.target.value)}
          placeholder="e.g. Delivery time: 3-5 din. Return policy: 7 din ke andar. Store timing: 10am-8pm..." />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button style={styles.primaryBtnSmall} onClick={handleSaveKb} disabled={savingKb}>{savingKb ? 'Saving…' : 'Save'}</button>
          {kbSaved && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Saved</span>}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.stepLabel}><Tags size={15} /> Keyword Rules (AI se pehle check hote hain)</div>
        <p style={styles.hint}>If a customer's message matches a keyword, a fixed reply is sent instantly — the AI isn't called at all. Everything else is handled by the AI.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <input style={styles.select} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword, e.g. price" />
          <select style={styles.select} value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            <option value="contains">Message contains this</option>
            <option value="exact">Message exactly this</option>
          </select>
        </div>
        <textarea style={{ ...styles.select, minHeight: 60, resize: 'vertical', marginTop: 8 }} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="The fixed reply to send" />
        <button style={{ ...styles.primaryBtnSmall, marginTop: 8 }} onClick={handleAddRule} disabled={addingRule}><Plus size={13} /> {addingRule ? 'Adding…' : 'Add Rule'}</button>

        <table style={{ ...styles.table, marginTop: 16 }}>
          <thead>
            <tr><th style={styles.th}>Keyword</th><th style={styles.th}>Match</th><th style={styles.th}>Reply</th><th style={{ ...styles.th, textAlign: 'right' }}>Actions</th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={styles.tr}>
                <td style={styles.td}>{r.keyword}</td>
                <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{r.match_type}</td>
                <td style={{ ...styles.td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reply_text}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button onClick={() => handleDeleteRule(r.id)} style={{ ...styles.actionBtn, ...styles.deleteCampaignBtn }}><Trash2 size={13} /> Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '20px 0' }}>No keyword rules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles = {
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  sub: { fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 6 },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 16 },
  refreshBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: '#fff', fontSize: 12.5, fontWeight: 600 },
  newBtn: { display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg, #25D366, #128C7E)', color: '#fff', fontSize: 13.5, fontWeight: 700 },
  fadedSection: { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.3)' },
  grid: { display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 20 },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 },
  stepLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  toggleBtnActive: { border: '1px solid var(--accent-purple)', background: 'var(--accent-purple-soft)', color: 'var(--accent-purple)' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 12, marginBottom: 5 },
  select: { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: '#fff', boxSizing: 'border-box' },
  primaryBtnSmall: { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-purple)', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' },
  primaryBtn: { width: '100%', marginTop: 10, padding: '12px 16px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg, #25D366, #128C7E)', color: '#fff', fontSize: 14, fontWeight: 700 },
  hint: { fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8 },
  miniStat: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 },
  miniLabel: { fontSize: 11.5, color: 'var(--text-secondary)' },
  miniValue: { fontSize: 22, fontWeight: 800, marginTop: 6 },
  downloadBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 16px', borderRadius: 12, border: 'none', background: 'var(--text-primary)', color: '#fff', fontSize: 13.5, fontWeight: 700 },
  deleteContactsBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #FCD7D3', background: '#fff', color: 'var(--danger)', fontSize: 11.5, fontWeight: 700 },
  emptyCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, borderRadius: 'var(--radius)', border: '1px dashed var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '10px 8px', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '13px 8px', fontSize: 13.5 },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', fontSize: 12, fontWeight: 600 },
  deleteCampaignBtn: { border: '1px solid #FCD7D3', color: 'var(--danger)' },
}
