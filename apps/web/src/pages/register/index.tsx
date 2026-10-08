import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  FaRegUser,
  FaRegEnvelope,
  FaLock,
  FaSpinner,
  FaCircleExclamation,
  FaArrowRight,
} from 'react-icons/fa6'
import { useAuthStore } from '../../store/auth-store'
import { AuthField, AuthShell } from '../../components/AuthShell'

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { register, status, error, clearError } = useAuthStore()
  const authenticated = status === 'authenticated'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    await register(email, password, fullName)
    if (useAuthStore.getState().status === 'authenticated') {
      void navigate('/')
    }
  }

  if (authenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <AuthShell
      subtitle="Create your account to get started."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors"
          >
            Sign in
            <FaArrowRight className="text-[12px] font-bold" />
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="p-8 flex flex-col gap-6">
        <AuthField
          id="fullName"
          label="Full name"
          icon={FaRegUser}
          value={fullName}
          onChange={setFullName}
          placeholder="John Doe"
        />

        <AuthField
          id="email"
          label="Email address"
          type="email"
          icon={FaRegEnvelope}
          value={email}
          onChange={setEmail}
          placeholder="name@example.com"
        />

        <AuthField
          id="password"
          label="Password"
          icon={FaLock}
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((v) => !v)}
        />

        <AuthField
          id="confirmPassword"
          label="Confirm password"
          icon={FaLock}
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Confirm your password"
          showPassword={showConfirmPassword}
          onTogglePassword={() => setShowConfirmPassword((v) => !v)}
        />

        {(error ?? passwordError) && (
          <div
            role="alert"
            className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 p-2 rounded border border-red-500/20"
            onClick={clearError}
          >
            <FaCircleExclamation className="text-[14px] shrink-0" />
            <span>{passwordError ?? error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {status === 'loading' ? (
            <FaSpinner className="text-[18px] animate-spin" />
          ) : (
            'Create Account'
          )}
        </button>
      </form>
    </AuthShell>
  )
}
