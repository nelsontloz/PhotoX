import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * The compact confirm panel + Cancel/Confirm footer shared by ConfirmProvider and the admin
 * console's ConfirmDialog.
 */
export function ConfirmShell({
  title,
  confirmLabel = 'Confirm',
  destructive = false,
  ariaLabel,
  escapeKey,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel?: string;
  destructive?: boolean;
  ariaLabel?: string;
  escapeKey?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
      titleTag="h3"
      titleClassName="text-base font-semibold text-slate-100"
      headerClassName=""
      closeOnOverlay={false}
      escapeKey={escapeKey}
      ariaLabel={ariaLabel}
    >
      {children}
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={
            destructive
              ? 'text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg px-3 py-2 transition-colors'
              : 'text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const settle = (value: boolean) => {
    setPending((prev) => {
      prev?.resolve(value);
      return null;
    });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmShell
          title={pending.options.title}
          ariaLabel={pending.options.title}
          confirmLabel={pending.options.confirmLabel}
          destructive={pending.options.destructive}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        >
          {pending.options.body && (
            <p className="text-sm text-slate-400 mt-2">{pending.options.body}</p>
          )}
        </ConfirmShell>
      )}
    </ConfirmContext.Provider>
  );
}
