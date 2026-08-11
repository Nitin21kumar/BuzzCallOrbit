import { useState, useEffect, useRef } from 'react'
import { LayoutGrid, AudioLines, FileAudio, Megaphone, Music2, MessageCircle, MessageSquareText, Radio, Menu, Search, Bell, Sun, Moon, LogOut, Users as UsersIcon } from 'lucide-react'
import * as api from '../api'
import logo from '../assets/logo.jpeg'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutGrid, dot: '#22C55E' },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone, dot: '#7C5CFC' },
  { key: 'whatsapp', label: 'WhatsApp OBD', icon: MessageCircle, dot: '#25D366' },
  { key: 'sms', label: 'SMS', icon: MessageSquareText, dot: '#3B82F6', alwaysVisible: true, badge: 'Soon' },
  { key: 'rcs', label: 'RCS', icon: Radio, dot: '#A855F7', alwaysVisible: true, badge: 'Soon' },
  { key: 'tts', label: 'Text to Speech', icon: AudioLines, dot: '#3B82F6' },
  { key: 'stt', label: 'Speech to Text', icon: FileAudio, dot: '#F59E0B' },
  { key: 'voices', label: 'Manage Voices', icon: Music2, dot: '#EC4899' },
  { key: 'users', label: 'User Management', icon: UsersIcon, dot: '#14B8A6' },
]

const ROLE_LABEL = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' }

// Short beep via Web Audio API - no audio file needed.
function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
  } catch {
    // Audio not available in this environment - fail silently
  }
}

export default function Sidebar({ active, setActive, collapsed, onToggleCollapse, searchActive, onToggleSearch, user, onLogout, visibleModules, role }) {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('obd-theme') === 'dark'
  })

  const canSeeWhatsApp = visibleModules.includes('whatsapp')
  const [handoffCount, setHandoffCount] = useState(0)
  const prevHandoffCount = useRef(0)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    window.localStorage.setItem('obd-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    if (!canSeeWhatsApp) return
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [canSeeWhatsApp])

  // Polls for conversations waiting on a human reply, so a paused AI chat
  // isn't missed even if the WhatsApp OBD tab isn't open. Only polls (and
  // only shows the nav badge) when the signed-in user actually has access
  // to the WhatsApp module — no point hitting an endpoint they can't use.
  useEffect(() => {
    if (!canSeeWhatsApp) { setHandoffCount(0); return }
    const poll = async () => {
      try {
        const res = await api.getHandoffCount()
        const count = res.data.count
        if (count > prevHandoffCount.current) {
          playAlertBeep()
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('WhatsApp — Human needed', {
              body: `${count} conversation${count > 1 ? 's are' : ' is'} waiting for a human reply.`,
            })
          }
        }
        prevHandoffCount.current = count
        setHandoffCount(count)
      } catch {
        // WhatsApp module may not be configured yet - ignore polling errors
      }
    }
    poll()
    const timer = setInterval(poll, 8000)
    return () => clearInterval(timer)
  }, [canSeeWhatsApp])

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
        <img src={logo} alt="Buzz Connect" className="sidebar-brand-icon sidebar-brand-icon--img" />
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">Buzz Connect</div>
          <div className="sidebar-brand-sub">Platform</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.filter((item) => item.alwaysVisible || visibleModules.includes(item.key)).map((item) => {
          const Icon = item.icon
          const isActive = active === item.key
          const showHandoffBadge = item.key === 'whatsapp' && handoffCount > 0
          return (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={`nav-item${isActive ? ' nav-item--active' : ''}`}
              title={item.label}
            >
              <Icon size={17} className="nav-item-icon" style={{ opacity: isActive ? 1 : 0.75 }} />
              <span className="nav-item-label">{item.label}</span>
              {showHandoffBadge ? (
                <span style={{
                  background: '#F04438', color: '#fff', fontSize: 10.5, fontWeight: 800,
                  borderRadius: 99, minWidth: 17, height: 17, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: '0 5px',
                }}>{handoffCount}</span>
              ) : item.badge ? (
                <span style={{
                  background: 'var(--accent-purple-soft)', color: 'var(--accent-purple)', fontSize: 9.5, fontWeight: 800,
                  borderRadius: 99, padding: '2px 7px', letterSpacing: '0.02em', textTransform: 'uppercase',
                }}>{item.badge}</span>
              ) : (
                <span className="nav-item-dot" style={{ background: item.dot }} />
              )}
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
        <button className="sidebar-icon-btn" title={handoffCount > 0 ? `${handoffCount} chat(s) need a human` : 'Notifications'} aria-label="Notifications" style={{ position: 'relative' }}>
          <Bell size={16} />
          {handoffCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%',
              background: '#F04438', border: '1.5px solid var(--bg-card)',
            }} />
          )}
        </button>
      </div>

      <div className="sidebar-footer">
        <img
          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user?.email || 'admin')}`}
          alt={user?.displayName || 'Admin'}
          className="sidebar-footer-avatar"
        />
        <div className="sidebar-footer-text">
          <div className="sidebar-footer-name">{user?.displayName || user?.email || 'Admin User'}</div>
          <div className="sidebar-footer-role">{ROLE_LABEL[role] || 'User'}</div>
        </div>
        <button
          className="sidebar-icon-btn sidebar-logout-btn"
          onClick={onLogout}
          title="Log out"
          aria-label="Log out"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
