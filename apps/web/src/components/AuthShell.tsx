import type { ReactNode } from 'react'
import { FaCamera, FaCircleExclamation, FaEye, FaEyeSlash, FaSpinner } from 'react-icons/fa6'

/** Shared login/register page shell: outer background, logo block, card and version footer. */
export function AuthShell({
  subtitle,
  footer,
  children,
}: {
  subtitle: string
  footer: ReactNode
  children: ReactNode
}) {
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
          <p className="text-slate-500 dark:text-slate-400 text-sm font-normal">{subtitle}</p>
        </div>

        <div className="w-full rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden">
          {children}
          <div className="px-8 py-5 bg-slate-50 dark:bg-footer-dark border-t border-slate-200 dark:border-slate-800 text-center">
            <p className="text-slate-500 dark:text-slate-400 text-sm">{footer}</p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-600 font-medium">PhotoX v2.4.0</p>
        </div>
      </div>
    </div>
  )
}

interface AuthFieldProps {
  id: string
  label: string
  icon: typeof FaCamera
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: 'text' | 'email' | 'password'
  /** Password fields: pass the toggle state/handler to get the eye button. */
  showPassword?: boolean
  onTogglePassword?: () => void
}

/** Icon-prefixed auth input; a toggle handler turns it into a password field with the eye button. */
export function AuthField({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  showPassword,
  onTogglePassword,
}: AuthFieldProps) {
  const toggles = onTogglePassword !== undefined
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={id}>
        {label}
      </label>
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
          <Icon className="text-[15px]" />
        </div>
        <input
          id={id}
          type={toggles ? (showPassword ? 'text' : 'password') : type}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 ${toggles ? 'pr-10' : 'pr-4'} py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200 outline-none`}
          placeholder={placeholder}
        />
        {toggles && (
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 pr-3 flex items-center rounded-md text-slate-400 hover:text-slate-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            {showPassword ? (
              <FaEyeSlash className="text-[15px]" />
            ) : (
              <FaEye className="text-[15px]" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

/** Dismissible auth error alert; renders nothing when there is no message. */
export function AuthError({
  message,
  onClear,
}: {
  message: string | null | undefined
  onClear: () => void
}) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 p-2 rounded border border-red-500/20"
      onClick={onClear}
    >
      <FaCircleExclamation className="text-[14px] shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/** Full-width auth submit: spinner while loading, label otherwise. */
export function AuthSubmit({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
    >
      {loading ? <FaSpinner className="text-[18px] animate-spin" /> : label}
    </button>
  )
}
