import { Rocket, Sparkle } from 'lucide-react'

// A polished "coming soon" placeholder — used for channels that have a nav
// slot reserved but no functionality built yet (currently SMS and RCS).
export default function UnderDevelopment({ label, description, accent = 'purple' }) {
  return (
    <div className="under-dev-page">
      <div className="under-dev-glow" />
      <div className={`under-dev-badge under-dev-badge--${accent}`}>
        <Rocket size={30} color="#fff" />
        <Sparkle className="under-dev-badge-sparkle under-dev-badge-sparkle--a" size={14} />
        <Sparkle className="under-dev-badge-sparkle under-dev-badge-sparkle--b" size={10} />
      </div>
      <span className="under-dev-pill">Coming Soon</span>
      <h1 className="under-dev-title">{label}</h1>
      <p className="under-dev-copy">{description}</p>
      <p className="under-dev-footer">We're building this out — check back soon.</p>
    </div>
  )
}
