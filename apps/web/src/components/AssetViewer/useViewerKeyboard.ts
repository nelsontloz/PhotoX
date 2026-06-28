import { useEffect } from 'react'

export function useViewerKeyboard(opts: {
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev: boolean
  hasNext: boolean
}): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') opts.onClose()
      else if (e.key === 'ArrowLeft' && opts.hasPrev && opts.onPrev) opts.onPrev()
      else if (e.key === 'ArrowRight' && opts.hasNext && opts.onNext) opts.onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opts.onClose, opts.onPrev, opts.onNext, opts.hasPrev, opts.hasNext])
}
