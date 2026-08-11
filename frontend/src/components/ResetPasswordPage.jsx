import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldAlert } from 'lucide-react'
import { FirebaseError } from 'firebase/app'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase.js'

const ERROR_MESSAGES = {
  'auth/expired-action-code': 'This reset link has expired. Request a new one.',
  'auth/invalid-action-code': 'This reset link is invalid or has already been used. Request a new one.',
  'auth/user-disabled': 'This account has been deactivated. Contact your admin.',
  'auth/user-not-found': 'No account found for this reset link.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
}

function errorMessage(error) {
  const code = error instanceof FirebaseError ? error.code : ''
  return ERROR_MESSAGES[code] || 'Something went wrong. Please try again.'
}

// Rendered instead of the normal login/app flow whenever the URL contains
// Firebase's password-reset params (?mode=resetPassword&oobCode=...) — i.e.
// right after someone clicks the link from their "Reset your Buzz Connect
// password" email. Firebase's oobCode proves they own the email address; we
// never see or need their old password.
export default function ResetPasswordPage({ oobCode, onDone }) {
  const [stage, setStage] = useState('verifying') // verifying | ready | invalid | done
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    verifyPasswordResetCode(firebaseAuth, oobCode)
      .then((verifiedEmail) => { setEmail(verifiedEmail); setStage('ready') })
      .catch((err) => { setError(errorMessage(err)); setStage('invalid') })
  }, [oobCode])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) return setError('Use a password with at least 6 characters.')
    if (password !== confirmPw) return setError("Passwords don't match.")
    setError('')
    setBusy(true)
    try {
      await confirmPasswordReset(firebaseAuth, oobCode, password)
      setStage('done')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-page-glow-a" />
      <div className="auth-page-glow-b" />
      <div style={{ position: 'relative', display: 'flex', minHeight: 'calc(100vh - 48px)', alignItems: 'center', justifyContent: 'center' }}>
        <section className="auth-card">
          {stage === 'verifying' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <LoaderCircle className="auth-spin" size={28} color="var(--accent-purple)" />
              <p className="auth-subtitle" style={{ marginTop: 14 }}>Checking your reset link…</p>
            </div>
          )}

          {stage === 'invalid' && (
            <div style={{ textAlign: 'center' }}>
              <div className="welcome-modal-icon" style={{ margin: '0 auto', background: 'linear-gradient(145deg, var(--danger), #F97316)' }}>
                <ShieldAlert size={24} color="#fff" />
              </div>
              <h1 className="auth-title" style={{ marginTop: 16 }}>Link no longer valid</h1>
              <p className="auth-subtitle">{error}</p>
              <button className="auth-submit-btn" style={{ marginTop: 22 }} onClick={onDone}>
                <ArrowLeft size={16} style={{ marginRight: 6 }} /> Back to sign in
              </button>
            </div>
          )}

          {stage === 'ready' && (
            <>
              <p className="auth-eyebrow">Reset your password</p>
              <h1 className="auth-title">Choose a new password</h1>
              <p className="auth-subtitle">for <strong>{email}</strong></p>

              <form onSubmit={handleSubmit} className="auth-form">
                <label className="auth-field-label">
                  New password
                  <div className="auth-input-wrap">
                    <LockKeyhole className="auth-input-icon" size={17} />
                    <input
                      required minLength={6}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Enter a new password"
                      className="auth-input auth-input--pl auth-input--pr"
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Show password" className="auth-input-toggle">
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
                <label className="auth-field-label">
                  Confirm new password
                  <div className="auth-input-wrap">
                    <LockKeyhole className="auth-input-icon" size={17} />
                    <input
                      required minLength={6}
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Re-enter the new password"
                      className="auth-input auth-input--pl"
                    />
                  </div>
                </label>

                {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, margin: 0 }}>{error}</p>}

                <button disabled={busy} className="auth-submit-btn">
                  {busy ? <LoaderCircle className="auth-spin" size={18} /> : 'Reset password'}
                </button>
              </form>
            </>
          )}

          {stage === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div className="welcome-modal-icon" style={{ margin: '0 auto' }}>
                <CheckCircle2 size={24} color="#fff" />
              </div>
              <h1 className="auth-title" style={{ marginTop: 16 }}>Password reset</h1>
              <p className="auth-subtitle">You can now sign in to Buzz Connect with your new password.</p>
              <button className="auth-submit-btn" style={{ marginTop: 22 }} onClick={onDone}>
                Continue to sign in
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
