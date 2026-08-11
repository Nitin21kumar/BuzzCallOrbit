import { useEffect } from 'react'
import { X, PartyPopper } from 'lucide-react'

// Centered "Welcome back" popup shown once per session right after the
// dashboard first loads. Dims the page behind it; closing it (X, the button,
// clicking the backdrop, or Escape) reveals the dashboard underneath.
export default function WelcomeModal({ name, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="welcome-modal-overlay" onClick={onClose}>
      <div className="welcome-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="welcome-modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className="welcome-modal-icon"><PartyPopper size={26} color="#fff" /></div>
        <h2 className="welcome-modal-title">Welcome back, {name}!</h2>
        <p className="welcome-modal-sub">Here's what's happening with your calling campaigns today.</p>
        <button className="welcome-modal-btn" onClick={onClose}>Let's go</button>
      </div>
    </div>
  )
}
