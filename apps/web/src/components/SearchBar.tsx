import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FaMagnifyingGlass, FaSpinner, FaXmark } from 'react-icons/fa6'
import { useSearchStore } from '../store/search-store'

const DEBOUNCE_MS = 300

interface SearchInputProps {
  /** Focus the field on mount (mobile overlay). */
  autoFocus?: boolean
  /** Escape on an already-empty field — the mobile overlay uses it to leave search mode. */
  onEscape?: () => void
  className?: string
}

export function SearchInput({ autoFocus, onEscape, className = '' }: SearchInputProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const loading = useSearchStore((s) => s.loading || s.loadingMore)
  const urlQ = searchParams.get('q') ?? ''
  const [value, setValue] = useState(urlQ)
  // Last query this field put in the URL. Lets external changes (Back, links) flow back into
  // the field without our own navigation echoing in and fighting the typist.
  const lastPushedRef = useRef(urlQ)

  useEffect(() => {
    if (urlQ === lastPushedRef.current) return
    lastPushedRef.current = urlQ
    setValue(urlQ)
  }, [urlQ])

  const commit = useCallback(
    (q: string) => {
      lastPushedRef.current = q
      const onSearchPage = location.pathname === '/search'
      // clearing the field on another page is not a search: leave the URL alone
      if (!q && !onSearchPage) return
      // first query pushes (Back returns to where you were); refinements on /search replace
      void navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search', { replace: onSearchPage })
    },
    [location.pathname, navigate],
  )

  useEffect(() => {
    const q = value.trim()
    const timer = setTimeout(() => {
      if (q !== lastPushedRef.current) commit(q)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value, commit])

  const clear = () => {
    setValue('')
    // don't wait out the debounce for an explicit clear
    if (location.pathname === '/search') commit('')
    else lastPushedRef.current = ''
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (value) clear()
      else onEscape?.()
      return
    }
    if (e.key === 'Enter') {
      const q = value.trim()
      if (q !== lastPushedRef.current) commit(q)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <FaMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none" />
      <input
        type="text"
        enterKeyHint="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search photos…"
        aria-label="Search photos and videos"
        className="w-full h-9 rounded-full bg-slate-100 dark:bg-card-dark border border-transparent dark:border-border-dark pl-9 pr-9 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/25"
      />
      {loading ? (
        <FaSpinner className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-sm animate-spin" />
      ) : (
        value && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 size-5 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            <FaXmark className="text-xs" />
          </button>
        )
      )}
    </div>
  )
}
