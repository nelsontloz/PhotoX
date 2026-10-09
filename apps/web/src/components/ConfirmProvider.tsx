import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'

interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  /** Red confirm button for destructive actions. */
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider')
  return confirm
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false)
          return { options, resolve }
        })
      }),
    [],
  )

  const settle = (value: boolean) => {
    setPending((prev) => {
      prev?.resolve(value)
      return null
    })
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          title={pending.options.title}
          onClose={() => settle(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          ariaLabel={pending.options.title}
        >
          {pending.options.body && (
            <p className="text-sm text-slate-400 mt-2">{pending.options.body}</p>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => settle(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className={
                pending.options.destructive
                  ? 'text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg px-3 py-2 transition-colors'
                  : 'text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors'
              }
            >
              {pending.options.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  )
}
