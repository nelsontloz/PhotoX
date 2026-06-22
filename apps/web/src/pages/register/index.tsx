import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FaCamera,
  FaRegUser,
  FaRegEnvelope,
  FaLock,
  FaEye,
  FaEyeSlash,
  FaSpinner,
  FaCircleExclamation,
  FaArrowRight,
} from 'react-icons/fa6'
import { useAuthStore } from '../../store/auth-store'

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

  return (
    <div className="font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 antialiased min-h-screen flex flex-col justify-center items-center overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="w-full max-w-md p-6">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20 text-primary mb-4">
            <FaCamera className="text-2xl" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white mb-2">
            PhotoX
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-normal">
            Create your account to get started.
          </p>
        </div>

        <div className="w-full rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden">
          <form onSubmit={(e) => void handleSubmit(e)} className="p-8 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="fullName"
              >
                Full name
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <FaRegUser className="text-[15px]" />
                </div>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200 outline-none"
                  placeholder="John Doe"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="email"
              >
                Email address
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <FaRegEnvelope className="text-[15px]" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200 outline-none"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="password"
              >
                Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <FaLock className="text-[15px]" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-10 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200 outline-none"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                >
                  {showPassword ? (
                    <FaEyeSlash className="text-[15px]" />
                  ) : (
                    <FaEye className="text-[15px]" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="confirmPassword"
              >
                Confirm password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <FaLock className="text-[15px]" />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-10 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200 outline-none"
                  placeholder="Confirm your password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                >
                  {showConfirmPassword ? (
                    <FaEyeSlash className="text-[15px]" />
                  ) : (
                    <FaEye className="text-[15px]" />
                  )}
                </button>
              </div>
            </div>

            {(error ?? passwordError) && (
              <div
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

          <div className="px-8 py-5 bg-slate-50 dark:bg-footer-dark border-t border-slate-200 dark:border-slate-800 text-center">
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors"
              >
                Sign in
                <FaArrowRight className="text-[12px] font-bold" />
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-600 font-medium">PhotoX v2.4.0</p>
        </div>
      </div>
    </div>
  )
}
