import { useState, useEffect } from 'react'
import { Phone, LayoutGrid, AudioLines, FileAudio, Megaphone, Music2, Menu, Search, Bell, Sun, Moon } from 'lucide-react'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutGrid, dot: '#22C55E' },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone, dot: '#7C5CFC' },
  { key: 'tts', label: 'Text to Speech', icon: AudioLines, dot: '#3B82F6' },
  { key: 'stt', label: 'Speech to Text', icon: FileAudio, dot: '#F59E0B' },
  { key: 'voices', label: 'Manage Voices', icon: Music2, dot: '#EC4899' },
]

export default function Sidebar({ active, setActive, collapsed, onToggleCollapse, searchActive, onToggleSearch }) {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('obd-theme') === 'dark'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    window.localStorage.setItem('obd-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-top-row">
        <button
          className="sidebar-icon-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label="Toggle sidebar"
        >
          <Menu size={17} />
        </button>
        <button
          className={`sidebar-icon-btn${searchActive ? ' sidebar-icon-btn--active' : ''}`}
          onClick={onToggleSearch}
          title="Search campaigns"
          aria-label="Search"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="sidebar-brand">
        <div className="sidebar-brand-icon"><Phone size={20} color="#fff" /></div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">BUZZ CALL ORBIT</div>
          <div className="sidebar-brand-sub">Platform</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={`nav-item${isActive ? ' nav-item--active' : ''}`}
              title={item.label}
            >
              <Icon size={17} className="nav-item-icon" style={{ opacity: isActive ? 1 : 0.75 }} />
              <span className="nav-item-label">{item.label}</span>
              <span className="nav-item-dot" style={{ background: item.dot }} />
            </button>
          )
        })}
      </nav>

      <div className="sidebar-utility-row">
        <button
          className="sidebar-icon-btn"
          onClick={() => setDark((d) => !d)}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {dark ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <button className="sidebar-icon-btn" title="Notifications" aria-label="Notifications">
          <Bell size={16} />
        </button>
      </div>

      <div className="sidebar-footer">
        <img
          src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin"
          alt="Admin"
          className="sidebar-footer-avatar"
        />
        <div className="sidebar-footer-text">
          <div className="sidebar-footer-name">Admin User</div>
          <div className="sidebar-footer-role">Super Admin</div>
        </div>
      </div>
    </aside>
  )
}
