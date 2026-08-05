import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, Volume2, Folder } from 'lucide-react'
import * as api from '../api'

export default function AudioPlayerWidget() {
  const [folders, setFolders] = useState([])
  const [folderId, setFolderId] = useState('')
  const [voices, setVoices] = useState([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef(null)

  useEffect(() => {
    api.listVoiceFolders().then((res) => {
      setFolders(res.data)
      const withVoices = res.data.find((f) => f.voice_count > 0)
      if (withVoices) setFolderId(withVoices.id)
    })
  }, [])

  useEffect(() => {
    if (!folderId) return setVoices([])
    api.getTtsHistory(folderId).then((res) => {
      setVoices(res.data)
      setIndex(0)
      setPlaying(false)
    })
  }, [folderId])

  useEffect(() => {
    setPlaying(false)
    setProgress(0)
  }, [index])

  const currentFolder = folders.find((f) => f.id === folderId)
  const current = voices[index]

  const goPrev = () => setIndex((i) => (i - 1 + voices.length) % voices.length)   // manual only - no autoplay/carousel
  const goNext = () => setIndex((i) => (i + 1) % voices.length)

  const togglePlay = () => {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else audioRef.current.play()
    setPlaying(!playing)
  }

  const formatTime = (s) => {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  return (
    <div className="audio-card">
      <div className="audio-header-row">
        <h3 className="audio-title">Audio Player</h3>
        {folders.length > 0 && (
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="audio-folder-select">
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
      </div>

      {!current ? (
        <div className="audio-empty">
          <Folder size={22} color="rgba(255,255,255,0.4)" />
          <p className="audio-empty-text">No voices generated in this folder yet.</p>
        </div>
      ) : (
        <>
          <div className="audio-folder-row">
            <button onClick={goPrev} disabled={voices.length < 2} className="audio-arrow-btn"><ChevronLeft size={16} /></button>
            <div className="audio-folder-label">
              <Folder size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              {currentFolder?.name} <span className="audio-slide-count">· {index + 1}/{voices.length}</span>
            </div>
            <button onClick={goNext} disabled={voices.length < 2} className="audio-arrow-btn"><ChevronRight size={16} /></button>
          </div>

          <audio
            ref={audioRef}
            src={api.getTtsDownloadUrl(folderId, current.filename)}
            onTimeUpdate={(e) => setProgress(e.target.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.target.duration)}
            onEnded={() => setPlaying(false)}
          />

          <div className="audio-waveform">
            {Array.from({ length: 40 }).map((_, i) => {
              const played = duration ? (i / 40) * duration < progress : false
              const h = 6 + ((i * 37) % 22)
              return (
                <div
                  key={i}
                  className={`audio-wave-bar${playing && played ? ' audio-wave-bar--playing' : ''}`}
                  style={{ height: h, background: played ? '#A78BFA' : 'rgba(255,255,255,0.18)', animationDelay: `${(i % 10) * 0.08}s` }}
                />
              )
            })}
            <button onClick={togglePlay} className={`audio-play-btn${playing ? ' audio-play-btn--playing' : ''}`}>
              {playing ? <Pause size={20} fill="#fff" /> : <Play size={20} fill="#fff" style={{ marginLeft: 2 }} />}
            </button>
          </div>

          <div className="audio-time-row">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="audio-meta-row">
            <div>
              <div className="audio-meta-title">{current.language_name}.mp3</div>
              <div className="audio-meta-sub">Folder: {currentFolder?.name}</div>
            </div>
            <div className="audio-volume-row">
              <Volume2 size={14} color="rgba(255,255,255,0.6)" />
              <input
                type="range" min={0} max={1} step={0.05} defaultValue={1}
                onChange={(e) => { if (audioRef.current) audioRef.current.volume = e.target.value }}
                className="audio-volume-slider"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
