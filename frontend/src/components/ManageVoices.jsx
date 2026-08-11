import { useState, useEffect } from 'react'
import { Music2, Trash2, Download, RefreshCw, FolderX } from 'lucide-react'
import * as api from '../api'
import PermissionNotice from './PermissionNotice.jsx'

export default function ManageVoices() {
  const [folders, setFolders] = useState([])
  const [allVoices, setAllVoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [noViewAccess, setNoViewAccess] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [foldersRes, voicesRes] = await Promise.all([api.listVoiceFolders(), api.getTtsHistory()])
      setFolders(foldersRes.data)
      setAllVoices(voicesRes.data)
    } catch (error) {
      if (error?.response?.status === 403) setNoViewAccess(true)
      else throw error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDeleteVoice = async (folderId, languageCode, languageName, folderName) => {
    if (!confirm(`Delete the ${languageName} voice from "${folderName}"?`)) return
    try {
      await api.deleteVoice(folderId, languageCode)
      load()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not delete this voice')
    }
  }

  const handleDeleteFolder = async (folderId, folderName) => {
    if (!confirm(`Delete the entire "${folderName}" folder and all its voices? This cannot be undone.`)) return
    try {
      await api.deleteVoiceFolder(folderId)
      load()
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not delete this folder')
    }
  }

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Manage Voices</h1>
          <p style={styles.sub}>Every voice folder and its generated recordings. Delete anything you no longer need.</p>
        </div>
        <button style={styles.refreshBtn} onClick={load} disabled={loading}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
        </button>
      </div>

      {noViewAccess && <PermissionNotice label="voice folders" />}

      {folders.length === 0 && !loading && !noViewAccess && (
        <div style={styles.emptyCard}>
          <Music2 size={26} color="var(--text-secondary)" />
          <p style={{ ...styles.hint, marginTop: 10 }}>No voice folders yet. Go to Text to Speech to create one.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {folders.map((folder) => {
          const voices = allVoices.filter((v) => v.folder_id === folder.id)
          return (
            <div key={folder.id} style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h3 style={styles.cardTitle}>{folder.name}</h3>
                  <p style={styles.cardSub}>#{folder.id.slice(-6)} · {voices.length} voice{voices.length === 1 ? '' : 's'} generated</p>
                </div>
                <button style={styles.deleteFolderBtn} onClick={() => handleDeleteFolder(folder.id, folder.name)}>
                  <FolderX size={13} /> Delete Folder
                </button>
              </div>
              <div style={styles.voiceGrid}>
                {voices.length === 0 && <p style={styles.hint}>No voices generated in this folder yet.</p>}
                {voices.map((v) => (
                  <div key={v._id} style={styles.voiceRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.voiceLang}>{v.language_name}</div>
                      <div style={styles.voiceMeta}>{v.filename} · {new Date(v.updated_at).toLocaleDateString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <audio controls src={api.getTtsDownloadUrl(folder.id, v.filename)} style={{ height: 30, width: 150 }} />
                      <a href={api.getTtsDownloadUrl(folder.id, v.filename)} download={v.filename}>
                        <button style={styles.iconBtn}><Download size={13} /></button>
                      </a>
                      <button style={styles.deleteBtn} onClick={() => handleDeleteVoice(folder.id, v.language_code, v.language_name, folder.name)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  sub: { fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 6 },
  refreshBtn: { display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: '#fff', fontSize: 13, fontWeight: 600 },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 },
  cardHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: 700, margin: 0 },
  cardSub: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 },
  deleteFolderBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, border: '1px solid #FCD7D3', background: '#fff', color: 'var(--danger)', fontSize: 12, fontWeight: 700 },
  voiceGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  voiceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: '#FAFAFD', flexWrap: 'wrap', gap: 10 },
  voiceLang: { fontSize: 13.5, fontWeight: 700 },
  voiceMeta: { fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 },
  iconBtn: { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' },
  deleteBtn: { padding: '7px 9px', borderRadius: 8, border: '1px solid #FCD7D3', background: '#fff', color: 'var(--danger)' },
  emptyCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 50, borderRadius: 'var(--radius)', border: '1px dashed var(--border)' },
  hint: { fontSize: 13, color: 'var(--text-secondary)' },
}
