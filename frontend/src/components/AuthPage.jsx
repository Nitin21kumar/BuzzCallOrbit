import { useEffect, useState } from 'react'
import {
  Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Mic,
  MessageCircleMore, MessageSquareText, Radio, Sparkles,
} from 'lucide-react'
import { FirebaseError } from 'firebase/app'
import {
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword,
  GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  setPersistence, signInWithEmailAndPassword, signInWithPopup, updateProfile,
} from 'firebase/auth'
import { toast } from 'sonner'
import { firebaseAuth } from '../lib/firebase.js'
import logo from '../assets/logo.jpeg'

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

const AUTH_MESSAGES = {
  'auth/email-already-in-use': 'An account already exists for this email. Sign in instead.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'Add this domain under Firebase Authentication > Settings > Authorized domains.',
  'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
}

function authMessage(error) {
  const code = error instanceof FirebaseError ? error.code : ''
  return AUTH_MESSAGES[code] || 'Authentication failed. Please try again.'
}

// Renders the login/signup screen and calls onAuthenticated once Firebase
// reports a signed-in user. App.jsx owns the "am I logged in" state via its
// own onAuthStateChanged listener, this component only needs to drive the form.
export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) onAuthenticated?.(user)
    })
    return unsub
  }, [onAuthenticated])

  async function withPersistence(action) {
    await setPersistence(firebaseAuth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
    return action()
  }

  async function google() {
    setBusy(true)
    try {
      await withPersistence(() => signInWithPopup(firebaseAuth, googleProvider))
    } catch (error) {
      toast.error(authMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function microsoft() {
    toast.info('Microsoft sign-in is coming soon. Please use Google or Email for now.')
  }

  async function submit(event) {
    event?.preventDefault?.()
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await withPersistence(() => createUserWithEmailAndPassword(firebaseAuth, email.trim(), password))
        if (name.trim()) await updateProfile(result.user, { displayName: name.trim() })
        await sendEmailVerification(result.user)
        toast.success('Account created. Verification email sent.')
      } else {
        await withPersistence(() => signInWithEmailAndPassword(firebaseAuth, email.trim(), password))
      }
    } catch (error) {
      toast.error(authMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!email.trim()) return toast.error('Enter your email first.')
    try {
      // handleCodeInApp: true means the emailed link brings the person back
      // to THIS app (with ?mode=resetPassword&oobCode=... in the URL) instead
      // of Firebase's plain generic hosted page — App.jsx detects that and
      // shows our own branded ResetPasswordPage. Without this, Firebase would
      // show its own default reset UI.
      await sendPasswordResetEmail(firebaseAuth, email.trim(), {
        url: window.location.origin,
        handleCodeInApp: true,
      })
      return toast.success('Password reset email sent.')
    } catch (error) {
      return toast.error(authMessage(error))
    }
  }

  return (
    <AuthView
      mode={mode} setMode={setMode}
      name={name} setName={setName}
      email={email} setEmail={setEmail}
      password={password} setPassword={setPassword}
      showPassword={showPassword} setShowPassword={setShowPassword}
      rememberMe={rememberMe} setRememberMe={setRememberMe}
      busy={busy} google={google} microsoft={microsoft} submit={submit} reset={reset}
    />
  )
}

function AuthView(p) {
  return (
    <main className="auth-page">
      <div className="auth-page-glow-a" />
      <div className="auth-page-glow-b" />
      <div className="auth-page-grid">
        <LoginStory />
        <section className="auth-card">
          <p className="auth-eyebrow auth-eyebrow--mobile">{p.mode === 'signin' ? 'Secure workspace access' : 'Create your workspace'}</p>
          <h1 className="auth-title">{p.mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="auth-subtitle">
            {p.mode === 'signin' ? 'Sign in to continue to' : 'Sign up to get started with'} <BrandWord />
          </p>

          <EmailForm p={p} />

          <div className="auth-divider"><i /> or continue with <i /></div>

          <div className="auth-provider-list">
            <button type="button" onClick={p.google} disabled={p.busy} className="auth-provider-btn">
              <GoogleMark /> Sign in with Google
            </button>
            <button type="button" onClick={p.microsoft} disabled={p.busy} className="auth-provider-btn">
              <MicrosoftMark /> Sign in with Microsoft
            </button>
            <button type="button" onClick={p.submit} disabled={p.busy} className="auth-provider-btn">
              <Mail size={17} className="auth-provider-mail" /> Sign in with Email
            </button>
          </div>

          <ModeSwitch p={p} />
        </section>
      </div>
    </main>
  )
}

function BrandWord() {
  return <span className="auth-brand-word">Buzz Connect</span>
}

function LoginStory() {
  const features = [
    { title: 'Text to Speech', copy: 'Turn text into natural, human-like voice', icon: Mic, tone: 'violet' },
    { title: 'Speech to Text', copy: 'Convert voice into text with high accuracy', icon: MessageSquareText, tone: 'blue' },
    { title: 'Multi-Channel AI Agent', copy: 'Engage seamlessly via SMS, WhatsApp & RCS', icon: MessageCircleMore, tone: 'green' },
  ]
  return (
    <aside className="auth-story">
      <a href="/" className="auth-brand">
        <img src={logo} alt="Buzz Connect" className="auth-brand-logo" />
        <span>Buzz Connect</span>
      </a>

      <p className="auth-story-kicker">The All-in-One</p>
      <h2 className="auth-story-title">Conversational AI Platform</h2>
      <p className="auth-story-tagline">Talk. Type. Reach. — All with AI.</p>

      <div className="auth-story-showcase">
        <ul className="auth-feature-list">
          {features.map(({ title, copy, icon: Icon, tone }) => (
            <li key={title} className="auth-feature-row">
              <span className={`auth-feature-icon auth-feature-icon--${tone}`}><Icon size={19} /></span>
              <span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </span>
            </li>
          ))}
        </ul>
        <OrbitGraphic />
      </div>

      <p className="auth-story-footer"><em>Smarter Conversations. Greater Impact.</em></p>
    </aside>
  )
}

// A little "solar system": three channel icons orbit a glowing central bubble,
// each ring spinning at its own speed while the icon itself counter-rotates
// so it always stays upright — like a moon keeping the same face inward.
function OrbitGraphic() {
  const orbiters = [
    { icon: MessageCircleMore, tone: 'whatsapp', radius: 108, duration: 14, angle: 30 },
    { icon: MessageSquareText, tone: 'sms', radius: 108, duration: 18, angle: 190 },
    { icon: Radio, tone: 'rcs', radius: 108, duration: 22, angle: 300, label: 'RCS' },
  ]
  return (
    <div className="orbit-stage" aria-hidden="true">
      <div className="orbit-path" />
      <Sparkles className="orbit-sparkle orbit-sparkle--a" size={16} />
      <Sparkles className="orbit-sparkle orbit-sparkle--b" size={12} />

      <div className="orbit-center">
        <MessageCircleMore size={26} color="#fff" strokeWidth={2.2} />
      </div>

      {orbiters.map(({ icon: Icon, tone, radius, duration, angle, label }) => (
        <div key={tone} className="orbit-orbiter" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="orbit-orbiter-spin" style={{ animationDuration: `${duration}s` }}>
            <div className={`orbit-icon orbit-icon--${tone}`} style={{ '--radius': `${radius}px`, animationDuration: `${duration}s` }}>
              {label ? <span className="orbit-icon-label">{label}</span> : <Icon size={16} />}
            </div>
          </div>
        </div>
      ))}

      <div className="orbit-waveform">
        {[6, 12, 20, 28, 20, 14, 24, 16, 8].map((h, i) => (
          <span key={i} className="orbit-wave-bar" style={{ height: `${h}px`, animationDelay: `${i * 0.09}s` }} />
        ))}
      </div>
      <div className="orbit-mic-badge"><Mic size={16} color="#fff" /></div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" className="auth-provider-icon">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="auth-provider-icon">
      <rect width="7.2" height="7.2" x="0" y="0" fill="#F25022" />
      <rect width="7.2" height="7.2" x="8.8" y="0" fill="#7FBA00" />
      <rect width="7.2" height="7.2" x="0" y="8.8" fill="#00A4EF" />
      <rect width="7.2" height="7.2" x="8.8" y="8.8" fill="#FFB900" />
    </svg>
  )
}

function EmailForm({ p }) {
  return (
    <form onSubmit={p.submit} className="auth-form">
      {p.mode === 'signup' && (
        <label className="auth-field-label">
          Full name
          <input required value={p.name} onChange={(e) => p.setName(e.target.value)} autoComplete="name" placeholder="Enter your full name" className="auth-input" />
        </label>
      )}
      <label className="auth-field-label">
        Email address
        <div className="auth-input-wrap">
          <Mail className="auth-input-icon" size={17} />
          <input required type="email" value={p.email} onChange={(e) => p.setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email" className="auth-input auth-input--pl" />
        </div>
      </label>
      <label className="auth-field-label">
        Password
        <div className="auth-input-wrap">
          <LockKeyhole className="auth-input-icon" size={17} />
          <input
            required minLength={6}
            type={p.showPassword ? 'text' : 'password'}
            value={p.password}
            onChange={(e) => p.setPassword(e.target.value)}
            autoComplete={p.mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="Enter your password"
            className="auth-input auth-input--pl auth-input--pr"
          />
          <button type="button" onClick={() => p.setShowPassword(!p.showPassword)} aria-label="Show password" className="auth-input-toggle">
            {p.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </label>

      <div className="auth-row-between">
        <label className="auth-remember">
          <input type="checkbox" checked={p.rememberMe} onChange={(e) => p.setRememberMe(e.target.checked)} />
          Remember me
        </label>
        {p.mode === 'signin' && (
          <button type="button" onClick={p.reset} className="auth-forgot-btn">Forgot password?</button>
        )}
      </div>

      <button disabled={p.busy} className="auth-submit-btn">
        {p.busy ? <LoaderCircle className="auth-spin" size={18} /> : p.mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  )
}

function ModeSwitch({ p }) {
  return (
    <p className="auth-switch">
      {p.mode === 'signin' ? 'New to Buzz Connect?' : 'Already have an account?'}{' '}
      <button onClick={() => p.setMode(p.mode === 'signin' ? 'signup' : 'signin')} className="auth-switch-btn">
        {p.mode === 'signin' ? 'Create an account' : 'Sign in'}
      </button>
    </p>
  )
}
