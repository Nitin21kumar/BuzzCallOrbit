import { useState, useEffect, useRef } from 'react'
import { UploadCloud, FileAudio, History, Mic, Square, Trash2 } from 'lucide-react'
import { LANGUAGES } from '../languages'
import * as api from '../api'
import PermissionNotice from './PermissionNotice.jsx'

export default function SpeechToText() {
  const [mode, setMode] = useState('upload') // 'upload' | 'record'
  const [file, setFile] = useState(null)
  const [recordedUrl, setRecordedUrl] = useState(null)
  const [languageCode, setLanguageCode] = useState('unknown')
  const [translateToEnglish, setTranslateToEnglish] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [noViewAccess, setNoViewAccess] = useState(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const loadHistory = async () => {
    try {
      const res = await api.getSttHistory()
      setHistory(res.data)
    } catch (error) {
      if (error?.response?.status === 403) { setNoViewAccess(true); return }
      throw error
    }
  }

  useEffect(() => { loadHistory() }, [])

  // Clean up mic stream + timer + object URL if the component unmounts mid-recording
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchMode = (nextMode) => {
    if (isRecording) return
    setMode(nextMode)
    setResult(null)
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const ext = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
        const recordedFile = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type })
        setFile(recordedFile)
        setRecordedUrl(URL.createObjectURL(blob))
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      setIsRecording(true)
      setRecordSeconds(0)
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    } catch (err) {
      alert('Could not access the microphone. Please allow mic permission and try again.')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    clearInterval(timerRef.current)
  }

  const discardRecording = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedUrl(null)
    setFile(null)
    setResult(null)
    setRecordSeconds(0)
  }

  const formatSeconds = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleTranscribe = async () => {
    if (!file) return alert('Please choose an audio file first')
    setTranscribing(true)
    setResult(null)
    try {
      const res = await api.transcribeAudio(file, languageCode, translateToEnglish)
      setResult(res.data)
      loadHistory()
    } catch (error) {
      alert(error.response?.data?.detail || 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <div>
      <div style={styles.headerRow}>
        <h1 style={styles.title}>Speech to Text</h1>
        <p style={styles.sub}>Upload an audio file and get an accurate transcript — transcribed by Sarvam AI, then proofread by AI (Groq).</p>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.modeTabs}>
            <button type="button" onClick={() => switchMode('upload')} style={{ ...styles.modeTab, ...(mode === 'upload' ? styles.modeTabActive : {}) }}>
              <UploadCloud size={15} /> Upload File
            </button>
            <button type="button" onClick={() => switchMode('record')} style={{ ...styles.modeTab, ...(mode === 'record' ? styles.modeTabActive : {}) }}>
              <Mic size={15} /> Record Audio
            </button>
          </div>

          {mode === 'upload' && (
            <>
              <label style={{ ...styles.label, marginTop: 14, display: 'block' }}>AUDIO FILE</label>
              <label style={styles.dropzone}>
                <UploadCloud size={26} color="var(--text-secondary)" />
                <span style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {file ? file.name : 'Click to choose an audio file (mp3, wav, m4a…)'}
                </span>
                <input type="file" accept="audio/*" onChange={(e) => { setFile(e.target.files?.[0] || null); setRecordedUrl(null) }} style={{ display: 'none' }} />
              </label>
            </>
          )}

          {mode === 'record' && (
            <div style={{ marginTop: 14 }}>
              <label style={styles.label}>RECORD FROM MICROPHONE</label>
              <div style={styles.recordBox}>
                {!recordedUrl && (
                  <>
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      style={{ ...styles.micBtn, ...(isRecording ? styles.micBtnActive : {}) }}
                    >
                      {isRecording ? <Square size={22} fill="#fff" /> : <Mic size={24} />}
                    </button>
                    <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {isRecording ? `Recording… ${formatSeconds(recordSeconds)}` : 'Tap the mic to start speaking'}
                    </p>
                  </>
                )}

                {recordedUrl && (
                  <div style={{ width: '100%' }}>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      Recorded {formatSeconds(recordSeconds)} — listen back before transcribing
                    </p>
                    <audio controls src={recordedUrl} style={{ width: '100%' }} />
                    <button type="button" onClick={discardRecording} style={styles.reRecordBtn}>
                      <Trash2 size={14} /> Discard &amp; record again
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <label style={{ ...styles.label, marginTop: 18, display: 'block' }}>SPOKEN LANGUAGE (optional)</label>
          <select value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} style={styles.select}>
            <option value="unknown">Auto-detect</option>
            {LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
          </select>

          <label style={styles.toggleRow}>
            <input type="checkbox" checked={translateToEnglish} onChange={(e) => setTranslateToEnglish(e.target.checked)} />
            <span>
              <strong>Convert to English</strong>
              <span style={{ display: 'block', color: 'var(--text-secondary)', fontWeight: 400 }}>
                Properly translates the speech into English (not just same-sounding words in Latin script)
              </span>
            </span>
          </label>

          <button onClick={handleTranscribe} disabled={transcribing || !file} style={styles.generateBtn}>
            <FileAudio size={17} />{transcribing ? 'Transcribing…' : 'Transcribe audio'}
          </button>

          {result && (
            <div style={styles.resultBox}>
              <div style={styles.label}>TRANSCRIPT ({result.language_code}{result.spoken_language_code && result.spoken_language_code !== result.language_code ? ` · spoken in ${result.spoken_language_code}` : ''}) · corrected by AI</div>
              <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>{result.transcript || <i style={{ color: 'var(--text-secondary)' }}>No speech detected</i>}</p>

              {result.raw_transcript && result.raw_transcript !== result.transcript && (
                <details style={{ marginTop: 14 }}>
                  <summary style={{ ...styles.label, cursor: 'pointer' }}>SHOW RAW SARVAM TRANSCRIPT</summary>
                  <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{result.raw_transcript}</p>
                </details>
              )}
            </div>
          )}
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}><History size={16} style={{ marginRight: 6, verticalAlign: -2 }} />Transcription History</h3>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
            {noViewAccess && <PermissionNotice label="transcription history" />}
            {!noViewAccess && history.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No transcriptions yet.</p>}
            {history.map((item) => (
              <div key={item._id} style={styles.historyRow}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.filename} · {item.language_code} · {new Date(item.created_at).toLocaleString()}</div>
                <p style={{ marginTop: 4, fontSize: 13 }}>{item.transcript}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  headerRow: { marginBottom: 22 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  sub: { fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 6 },
  grid: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, alignItems: 'start' },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24 },
  cardTitle: { fontSize: 15.5, fontWeight: 700, margin: 0 },
  label: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em' },
  dropzone: {
    marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '30px 16px', borderRadius: 12, border: '1.5px dashed var(--border)', cursor: 'pointer', textAlign: 'center',
  },
  modeTabs: { display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 14 },
  modeTab: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10,
    border: '1px solid var(--border)', background: '#fff', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
  },
  modeTabActive: {
    borderColor: 'var(--accent-purple)', background: 'var(--accent-purple-soft)', color: 'var(--accent-purple)',
  },
  recordBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '28px 16px', borderRadius: 12, border: '1.5px dashed var(--border)', textAlign: 'center',
  },
  micBtn: {
    width: 64, height: 64, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, var(--accent-purple), var(--warning))', color: '#fff', cursor: 'pointer',
  },
  micBtnActive: { background: '#E4483E', animation: 'pulse 1.4s infinite' },
  reRecordBtn: {
    marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
    border: '1px solid var(--border)', background: '#fff', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)',
  },
  select: { width: '100%', marginTop: 8, padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13.5 },
  toggleRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: '12px 14px',
    borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer',
  },
  generateBtn: {
    width: '100%', marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '13px 16px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, color: '#fff',
    background: 'linear-gradient(135deg, var(--accent-purple), var(--warning))',
  },
  resultBox: { marginTop: 20, padding: 16, borderRadius: 12, background: '#FAFAFD', border: '1px solid var(--border)' },
  historyRow: { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' },
}
