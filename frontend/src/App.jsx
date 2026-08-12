import { useEffect, useState } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { toast } from 'sonner'
import { firebaseAuth, missingFirebaseEnvVars } from './lib/firebase.js'
import * as api from './api.js'
import { PermissionsProvider, usePermissions } from './permissions.jsx'
import AuthPage from './components/AuthPage.jsx'
import ResetPasswordPage from './components/ResetPasswordPage.jsx'
import Sidebar from './components/Sidebar.jsx'
import SearchBar from './components/SearchBar.jsx'
import Dashboard from './components/Dashboard.jsx'
import TextToSpeech from './components/TextToSpeech.jsx'
import SpeechToText from './components/SpeechToText.jsx'
import Campaigns from './components/Campaigns.jsx'
import ManageVoices from './components/ManageVoices.jsx'
import WhatsAppCampaigns from './components/WhatsAppCampaigns.jsx'
import UserManagement from './components/UserManagement.jsx'
import UnderDevelopment from './components/UnderDevelopment.jsx'
import AccessDenied from './components/AccessDenied.jsx'

const ALL_MODULES = ['dashboard', 'campaigns', 'whatsapp', 'tts', 'stt', 'voices', 'users']
const MODULE_LABEL = { dashboard: 'Dashboard', campaigns: 'Campaigns', whatsapp: 'WhatsApp', tts: 'Text to Speech', stt: 'Speech to Text', voices: 'Manage Voices', users: 'User Management', sms: 'SMS', rcs: 'RCS' }
// SMS and RCS are placeholder "coming soon" pages with no real functionality
// or data yet, so — unlike every other module — they're open to any signed-in
// user regardless of their granted permissions (mirrors Sidebar.jsx's
// alwaysVisible flag for these two nav items).
const ALWAYS_VISIBLE_MODULES = ['sms', 'rcs']

function FirebaseSetupNeeded() {
  return (
    <div className="auth-loading-screen">
      <div className="access-denied" style={{ maxWidth: 460 }}>
        <div className="access-denied-icon" style={{ background: 'linear-gradient(145deg, var(--warning), #F97316)' }}>
          <TriangleAlert size={26} color="#fff" />
        </div>
        <h2>Firebase setup needed</h2>
        <p>
          <code>frontend/.env</code> is missing or incomplete. Copy <code>.env.example</code> to <code>.env</code> and
          fill in your Firebase project's config (Project Settings &gt; General &gt; Your apps), then restart the dev server.
        </p>
        <p style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11.5 }}>
          Missing: {missingFirebaseEnvVars.join(', ')}
        </p>
      </div>
    </div>
  )
}

function App() {
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [user, setUser] = useState(null)

  const [profile, setProfile] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState(null)

  // If this page load is someone arriving from their "Reset your Buzz Connect
  // password" email, the URL carries Firebase's mode/oobCode params. This is
  // checked independent of sign-in state — the person is very likely NOT
  // signed in when clicking a reset link.
  const [resetOobCode, setResetOobCode] = useState(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('mode') === 'resetPassword' ? params.get('oobCode') : null
  })
  const clearResetFlow = () => {
    setResetOobCode(null)
    window.history.replaceState({}, '', window.location.pathname)
  }

  useEffect(() => {
    if (missingFirebaseEnvVars.length) return
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u)
      setCheckingAuth(false)
      if (!u) { setProfile(null); setCatalog(null) }
    })
    return unsub
  }, [])

  if (missingFirebaseEnvVars.length) {
    return <FirebaseSetupNeeded />
  }

  if (resetOobCode) {
    return <ResetPasswordPage oobCode={resetOobCode} onDone={clearResetFlow} />
  }


  const loadProfile = async () => {
    setLoadingProfile(true)
    setProfileError(null)
    try {
      const res = await api.getMyProfile()
      setProfile(res.data.profile)
      setCatalog(res.data.catalog)
    } catch (e) {
      setProfileError(e?.response?.data?.detail || 'Could not load your account. Please try signing in again.')
    } finally {
      setLoadingProfile(false)
    }
  }

  useEffect(() => { if (user) loadProfile() }, [user])

  if (checkingAuth) {
    return (
      <div className="auth-loading-screen">
        <LoaderCircle className="auth-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthPage onAuthenticated={setUser} />
  }

  if (loadingProfile || !profile || !catalog) {
    return (
      <div className="auth-loading-screen">
        {profileError ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 14 }}>{profileError}</p>
            <button className="dash-btn dash-btn--primary" onClick={loadProfile}>Retry</button>
          </div>
        ) : (
          <LoaderCircle className="auth-spin" />
        )}
      </div>
    )
  }

  return (
    <PermissionsProvider profile={profile} catalog={catalog} refreshProfile={loadProfile}>
      <AuthenticatedApp user={user} />
    </PermissionsProvider>
  )
}

function AuthenticatedApp({ user }) {
  const { profile, hasModule, refreshProfile } = usePermissions()

  const visibleModules = ALL_MODULES.filter((m) => hasModule(m))
  const [active, setActive] = useState(visibleModules[0] || 'dashboard')
  const [requestCreateCampaign, setRequestCreateCampaign] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const goToCreateCampaign = () => {
    setActive('campaigns')
    setRequestCreateCampaign(true)
  }

  const closeSearch = () => { setSearchActive(false); setSearchQuery('') }

  const isDashboard = active === 'dashboard'
  const isWhatsapp = active === 'whatsapp'
  const hasAccessToActive = visibleModules.includes(active) || ALWAYS_VISIBLE_MODULES.includes(active)

  if (visibleModules.length === 0) {
    return (
      <div className="auth-loading-screen">
        <AccessDenied
          moduleLabel="anything yet"
          onRefresh={refreshProfile}
          onLogout={async () => {
            await signOut(firebaseAuth)
            toast.success('Logged out successfully')
          }}
        />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        searchActive={searchActive}
        onToggleSearch={() => setSearchActive((s) => !s)}
        user={user}
        role={profile.role}
        visibleModules={visibleModules}
        onLogout={async () => {
          await signOut(firebaseAuth)
          toast.success('Logged out successfully')
        }}
      />
      <div className="app-content-col">
        <SearchBar active={searchActive} query={searchQuery} onQueryChange={setSearchQuery} onClose={closeSearch} />
        <main className={isDashboard ? 'app-main app-main--flush' : isWhatsapp ? 'app-main app-main--whatsapp' : 'app-main'}>
          {!hasAccessToActive && <AccessDenied moduleLabel={MODULE_LABEL[active]} />}
          {hasAccessToActive && active === 'dashboard' && <Dashboard user={user} onCreateCampaign={goToCreateCampaign} onOpenCampaigns={() => setActive('campaigns')} searchQuery={searchQuery} />}
          {hasAccessToActive && active === 'tts' && <TextToSpeech />}
          {hasAccessToActive && active === 'stt' && <SpeechToText />}
          {hasAccessToActive && active === 'voices' && <ManageVoices />}
          {hasAccessToActive && active === 'whatsapp' && <WhatsAppCampaigns />}
          {hasAccessToActive && active === 'sms' && <UnderDevelopment label="SMS Campaigns" description="Bulk & transactional SMS broadcasts — plan, send, and track delivery, right alongside your other channels." accent="blue" />}
          {hasAccessToActive && active === 'rcs' && <UnderDevelopment label="RCS Messaging" description="Rich, interactive RCS messages with buttons, carousels, and media — the next step up from plain SMS." accent="purple" />}
          {hasAccessToActive && active === 'users' && <UserManagement />}
          {hasAccessToActive && active === 'campaigns' && (
            <Campaigns
              initialCreate={requestCreateCampaign}
              onConsumeCreate={() => setRequestCreateCampaign(false)}
              onGoToDashboard={() => setActive('dashboard')}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
