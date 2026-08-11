import { useState, useEffect } from 'react'
import { Megaphone, UploadCloud, Music, FileSpreadsheet, Play, CheckCircle2, XCircle, Loader2, Download, RefreshCw, Eye, ArrowLeft, Lock, Trash2 } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import * as api from '../api'
import PermissionNotice from './PermissionNotice.jsx'

export default function Campaigns({ initialCreate, onConsumeCreate, onGoToDashboard }) {
  const [campaigns, setCampaigns] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [view, setView] = useState('list') // list | create | detail
  const [noViewAccess, setNoViewAccess] = useState(false)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const [audioMode, setAudioMode] = useState('voice-source')
  const [folders, setFolders] = useState([])
  const [voiceSourceId, setVoiceSourceId] = useState('')
  const [savingVoiceSource, setSavingVoiceSource] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [uploadingContacts, setUploadingContacts] = useState(false)
  const [deletingContacts, setDeletingContacts] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState(null)

  const activeCampaign = campaigns.find((c) => c.id === activeId) || null
  const launched = activeCampaign ? activeCampaign.status !== 'draft' : false

  const loadCampaigns = async () => {
    try {
      const res = await api.listCampaigns()
      setCampaigns(res.data)
      return res.data
    } catch (error) {
      if (error?.response?.status === 403) { setNoViewAccess(true); return [] }
      throw error
    }
  }

  useEffect(() => { loadCampaigns() }, [])
  useEffect(() => { api.listVoiceFolders().then((res) => setFolders(res.data)).catch(() => {}) }, [])
  useEffect(() => { if (initialCreate) { setView('create'); onConsumeCreate() } }, [initialCreate])
  useEffect(() => {
    if (activeCampaign) setVoiceSourceId(activeCampaign.voice_source_folder_id || '')
  }, [activeId, campaigns])

  const refreshStatus = async () => {
    if (!activeId) return
    const res = await api.getCampaignStatus(activeId)
    setStatus(res.data)
    return res.data
  }

  useEffect(() => { if (activeId) refreshStatus() }, [activeId])
  useEffect(() => {
    const stillWaiting = status?.campaign_status === 'running' || (status ? status.in_progress > 0 : false)
    if (!stillWaiting) return
    const timer = setInterval(async () => { await refreshStatus() }, 3000)
    return () => clearInterval(timer)
  }, [status, activeId])

  const handleCreate = async () => {
    if (!newName.trim()) return alert('Enter a campaign name')
    setCreating(true)
    try {
      const res = await api.createCampaign(newName.trim())
      setNewName('')
      await loadCampaigns()
      setActiveId(res.data.id)
      setStatus(null)
      setView('detail')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteCampaign = async (campaignId, campaignName) => {
    if (!confirm(`Permanently delete "${campaignName}"? This removes the campaign, its contacts, and its full call/report history. This cannot be undone.`)) return
    setDeletingId(campaignId)
    try {
      await api.deleteCampaign(campaignId)
      if (activeId === campaignId) {
        setActiveId(null)
        setStatus(null)
        setView('list')
      }
      await loadCampaigns()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not delete this campaign')
    } finally {
      setDeletingId(null)
    }
  }

  const handleUploadAudio = async (file) => {
    setUploadingAudio(true)
    try {
      await api.uploadCampaignAudio(activeId, file)
      await loadCampaigns()
    } catch (error) {
      alert(error.response?.data?.detail || 'Upload failed')
    } finally {
      setUploadingAudio(false)
    }
  }

  const handleSaveVoiceSource = async () => {
    if (!voiceSourceId) return alert('Select a voice folder first')
    setSavingVoiceSource(true)
    try {
      const res = await api.setCampaignVoiceSource(activeId, voiceSourceId)
      alert(res.data.message)
      await loadCampaigns()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not save the voice source')
    } finally {
      setSavingVoiceSource(false)
    }
  }

  const handleUploadContacts = async (file) => {
    setUploadingContacts(true)
    try {
      const res = await api.uploadCampaignContacts(activeId, file)
      alert(res.data.message)
      refreshStatus()
    } catch (error) {
      alert(error.response?.data?.detail || 'Upload failed')
    } finally {
      setUploadingContacts(false)
    }
  }

  const handleDeleteContacts = async () => {
    if (!confirm(`Delete all ${status?.total_contacts || ''} uploaded contact(s) for this campaign? You can upload a fresh sheet afterwards.`)) return
    setDeletingContacts(true)
    try {
      const res = await api.deleteCampaignContacts(activeId)
      alert(res.data.message)
      refreshStatus()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not delete contacts')
    } finally {
      setDeletingContacts(false)
    }
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await api.startCampaign(activeId)
      alert(res.data.message + '\n\nThis campaign is now locked — it can only ever be launched once. Redirecting to Dashboard…')
      await loadCampaigns()
      // A campaign can only be launched once - send the user back to the Dashboard immediately.
      onGoToDashboard()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not start the campaign')
    } finally {
      setStarting(false)
    }
  }

  const chartData = status ? [
    { name: 'Completed', value: status.completed, color: '#22C55E' },
    { name: 'Failed / Declined', value: status.failed_or_declined, color: '#F04438' },
    { name: 'In Progress', value: status.in_progress, color: '#F59E0B' },
  ].filter((d) => d.value > 0) : []

  if (view === 'detail' && activeCampaign) {
    return (
      <div>
        <button style={styles.backBtn} onClick={() => { setView('list'); setActiveId(null); setStatus(null); loadCampaigns() }}>
          <ArrowLeft size={15} /> All Campaigns
        </button>

        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>{activeCampaign.name}</h1>
            <p style={styles.sub}>Campaign #{activeCampaign.id.slice(-6)}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.refreshBtn} onClick={refreshStatus}><RefreshCw size={14} /> Refresh</button>
            <button
              style={{ ...styles.refreshBtn, ...styles.deleteCampaignBtn }}
              disabled={deletingId === activeCampaign.id}
              onClick={() => handleDeleteCampaign(activeCampaign.id, activeCampaign.name)}
            >
              <Trash2 size={14} /> {deletingId === activeCampaign.id ? 'Deleting…' : 'Delete Campaign'}
            </button>
          </div>
        </div>

        {launched && (
          <div style={styles.lockedBanner}>
            <Lock size={15} /> This campaign has already been launched. Setup is locked — each campaign can only be started once.
          </div>
        )}

        <div style={styles.grid}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...(launched ? styles.fadedSection : {}) }}>
            <div style={styles.card}>
              <div style={styles.stepLabel}><Music size={15} /> Step 1 — Which Voices To Call With</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button disabled={launched} onClick={() => setAudioMode('voice-source')} style={{ ...styles.toggleBtn, ...(audioMode === 'voice-source' ? styles.toggleBtnActive : {}) }}><Music size={13} /> Use a campaign's voice library</button>
                <button disabled={launched} onClick={() => setAudioMode('upload')} style={{ ...styles.toggleBtn, ...(audioMode === 'upload' ? styles.toggleBtnActive : {}) }}><UploadCloud size={13} /> Upload a fallback file</button>
              </div>

              {audioMode === 'voice-source' ? (
                <div style={{ marginTop: 12 }}>
                  <p style={styles.hint}>Per-contact Language values are matched against the voices in whichever <b>voice folder</b> you pick here (created on the Text to Speech page).</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <select disabled={launched} value={voiceSourceId} onChange={(e) => setVoiceSourceId(e.target.value)} style={{ ...styles.select, flex: 1 }}>
                      <option value="" disabled>Select a voice folder…</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.voice_count} voice{f.voice_count === 1 ? '' : 's'})</option>)}
                    </select>
                    <button onClick={handleSaveVoiceSource} disabled={launched || savingVoiceSource} style={styles.primaryBtnSmall}>{savingVoiceSource ? 'Saving…' : 'Save'}</button>
                  </div>
                  {folders.length === 0 && <p style={styles.hint}>No voice folders yet — create one on the Text to Speech page first.</p>}
                  <p style={styles.hint}>Currently using: <b>{folders.find(f => f.id === activeCampaign.voice_source_folder_id)?.name || 'none selected'}</b></p>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <input disabled={launched} type="file" accept=".mp3,.wav" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadAudio(f); e.target.value = '' }} />
                  <p style={styles.hint}>This single file is only used as a fallback for contacts whose sheet row has no Language value.</p>
                </div>
              )}
              {uploadingAudio && <p style={styles.hint}>Uploading…</p>}
              {activeCampaign.audio_filename && (
                <>
                  <p style={styles.successHint}><CheckCircle2 size={13} /> Fallback audio: {activeCampaign.audio_filename}</p>
                  <audio controls src={api.getCampaignAudioUrl(activeCampaign.id)} style={{ width: '100%', height: 32, marginTop: 6 }} />
                </>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.stepLabel}><FileSpreadsheet size={15} /> Step 2 — Contacts</div>
              <input disabled={launched} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadContacts(f); e.target.value = '' }} style={{ marginTop: 10 }} />
              <p style={styles.hint}>Needs a column named Phone / Phone Number / Mobile. Optional columns: <b>Name</b>, and <b>Language</b> (e.g. "Hindi", "Bengali") — each contact is called using that language's saved recording from the selected voice library above. If a contact's language has no matching recording, that number is skipped and marked in the Excel report.</p>
              {uploadingContacts && <p style={styles.hint}>Uploading…</p>}
              {!launched && status?.total_contacts > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, padding: '8px 12px', borderRadius: 10, background: '#FAFAFD', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{status.total_contacts} contact{status.total_contacts === 1 ? '' : 's'} uploaded</span>
                  <button onClick={handleDeleteContacts} disabled={deletingContacts} style={styles.deleteContactsBtn}>
                    <Trash2 size={13} /> {deletingContacts ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.stepLabel}><Play size={15} /> Step 3 — Start</div>
              <button
                onClick={handleStart}
                disabled={launched || starting}
                style={styles.primaryBtn}
              >
                {starting ? 'Starting…' : launched ? '🔒 Already launched' : '🚀 Start calling all contacts'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {status ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={styles.miniStat}><span style={styles.miniLabel}>Total Contacts</span><div style={styles.miniValue}>{status.total_contacts}</div></div>
                  <div style={styles.miniStat}><span style={styles.miniLabel}>Completed</span><div style={{ ...styles.miniValue, color: 'var(--success)' }}>{status.completed}</div></div>
                  <div style={styles.miniStat}><span style={styles.miniLabel}>Failed/Declined</span><div style={{ ...styles.miniValue, color: 'var(--danger)' }}>{status.failed_or_declined}</div></div>
                  <div style={styles.miniStat}><span style={styles.miniLabel}>In Progress</span><div style={{ ...styles.miniValue, color: 'var(--warning)' }}>{status.in_progress}</div></div>
                </div>
                <div style={styles.card}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Call Outcome Breakdown</h4>
                  {chartData.length > 0 ? (
                    <div style={{ height: 210 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
                            {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <p style={styles.hint}>Chart appears once calls are triggered.</p>}
                </div>
                <a href={api.getCampaignReportUrl(activeCampaign.id)}>
                  <button style={styles.downloadBtn}><Download size={16} /> Download Excel report</button>
                </a>
              </>
            ) : <div style={styles.emptyCard}><Megaphone size={22} color="var(--text-secondary)" /><p style={styles.hint}>Loading status…</p></div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Campaigns</h1>
          <p style={styles.sub}>Create, manage, and track your outbound calling campaigns.</p>
        </div>
        <button style={styles.newBtn} onClick={() => setView('create')}><Megaphone size={16} /> New Campaign</button>
      </div>

      {view === 'create' && (
        <div style={{ ...styles.card, maxWidth: 440, margin: '0 auto 24px' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Create a new campaign</h3>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="e.g. Diwali offer blast" style={{ ...styles.select, flex: 1 }} />
            <button onClick={handleCreate} disabled={creating} style={styles.primaryBtnSmall}>{creating ? 'Creating…' : 'Create'}</button>
          </div>
        </div>
      )}

      <div style={styles.card}>
        {noViewAccess ? (
          <PermissionNotice label="the campaigns list" />
        ) : (
        <table style={styles.table}>
          <thead>
            <tr><th style={styles.th}>Campaign</th><th style={styles.th}>Status</th><th style={styles.th}>Created</th><th style={{ ...styles.th, textAlign: 'right' }}>Actions</th></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} style={styles.tr}>
                <td style={styles.td}>{c.name}<div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>#{c.id.slice(-6)}</div></td>
                <td style={styles.td}>
                  <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: c.status === 'completed' ? 'var(--success-soft)' : c.status === 'running' ? 'var(--warning-soft)' : '#F1F2F6', color: c.status === 'completed' ? 'var(--success)' : c.status === 'running' ? 'var(--warning)' : '#6B7280' }}>{c.status}</span>
                </td>
                <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{new Date(c.created_at).toLocaleString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button onClick={() => { setActiveId(c.id); setStatus(null); setView('detail') }} style={styles.actionBtn}><Eye size={13} /> View</button>
                  <a href={api.getCampaignReportUrl(c.id)}><button style={{ ...styles.actionBtn, marginLeft: 8 }}><Download size={13} /> Report</button></a>
                  <button
                    onClick={() => handleDeleteCampaign(c.id, c.name)}
                    disabled={deletingId === c.id}
                    style={{ ...styles.actionBtn, ...styles.deleteCampaignBtn, marginLeft: 8 }}
                  >
                    <Trash2 size={13} /> {deletingId === c.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '30px 0' }}>No campaigns yet — create one to get started.</td></tr>}
          </tbody>
        </table>
        )}
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
  newBtn: { display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg, var(--accent-purple), var(--warning))', color: '#fff', fontSize: 13.5, fontWeight: 700 },
  lockedBanner: { display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 12, background: 'var(--warning-soft)', color: '#92650B', fontSize: 13, fontWeight: 600, marginBottom: 16 },
  fadedSection: { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.3)' },
  grid: { display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 20 },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 },
  stepLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  toggleBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: '#fff', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  toggleBtnActive: { border: '1px solid var(--accent-purple)', background: 'var(--accent-purple-soft)', color: 'var(--accent-purple)' },
  select: { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: '#fff' },
  primaryBtnSmall: { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-purple)', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' },
  primaryBtn: { width: '100%', marginTop: 10, padding: '12px 16px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg, var(--accent-purple), var(--warning))', color: '#fff', fontSize: 14, fontWeight: 700 },
  hint: { fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8 },
  successHint: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--success)', marginTop: 10, fontWeight: 600 },
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
