import { useState } from 'react'
import {
  FaCircleExclamation,
  FaDatabase,
  FaPenToSquare,
  FaSpinner,
  FaTriangleExclamation,
} from 'react-icons/fa6'
import type {
  AdminUserBackupSync,
  AdminUserRow,
  AdminUserUpdateRequest,
  AdminUserUpdateResponse,
} from '@photox/shared-types'
import { Dialog, formInputClass } from '../../components/Dialog'
import { updateAdminUser } from '../../api/admin'
import { RoleBadge, emailLooksValid } from './shared'
import { StatusPill, cx } from './ui'
import { httpErrorMessage, type HttpErrorMessages } from './http-error'

// --- account edit dialog -----------------------------------------------------------------
// Three fields (name, email, new password) over the same identity card + impact-note language
// as DeleteUserDialog. Nothing is sent unless it actually differs, so the submit button is the
// dirty indicator. An email change makes this a LONG request: the core moves the user's S3
// backup inline, so the working state says so out loud instead of looking like a quick save —
// and the dialog cannot be dismissed until the move lands or fails.

/** The core normalizes emails before saving, so casing/whitespace alone is not a change. */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const PASSWORD_MIN = 8
const NAME_MAX = 64

const UPDATE_FAILED = 'Update failed. Try again.'
const LOST_CONTACT =
  'Lost contact with the server — the account may already be updated. Refresh the list and check before retrying.'
const BAD_REQUEST = "That change can't be saved — check the fields and try again."

/** Never leak axios verbatim; the server statuses map to plain sentences. */
export const UPDATE_ERROR_MESSAGES: HttpErrorMessages = {
  fallback: UPDATE_FAILED,
  byStatus: {
    409: 'That email is already in use.',
    404: 'That user no longer exists. Close this and refresh the list.',
    403: 'Only an admin can do that.',
    400: ({ text }) => text.trim() || BAD_REQUEST,
  },
  timeout: LOST_CONTACT,
  preferServerMessage: true,
}

/** Retry-move failures land in the persistent warning box, so the 404 wording drops "close this". */
export const BACKUP_RETRY_ERROR_MESSAGES: HttpErrorMessages = {
  fallback: "The backup move didn't go through — try again.",
  byStatus: {
    404: 'That user no longer exists — refresh the list.',
    403: 'Only an admin can do that.',
  },
  timeout: "Couldn't reach the server — try the move again.",
  preferServerMessage: true,
}

/** What the section needs after a successful save: the fresh row, the backup outcome, the diff. */
export interface UserEditOutcome {
  user: AdminUserUpdateResponse['user']
  backup: AdminUserBackupSync
  emailChanged: boolean
  /** True when this save revoked the signed-in admin's own session (self email/password). */
  signedOut: boolean
}

export function EditUserDialog({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: AdminUserRow
  isSelf: boolean
  onClose: () => void
  onDone: (outcome: UserEditOutcome) => void
}) {
  const [name, setName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const nameChanged = trimmedName !== user.displayName
  const emailChanged = !sameEmail(email, user.email)
  // Passwords are hashed, so there is no value to compare: typing anything means "set this".
  // Blank is the unchanged signal the core expects.
  const passwordChanged = password.length > 0

  const nameInvalid = nameChanged && trimmedName.length === 0
  const emailInvalid = emailChanged && !emailLooksValid(trimmedEmail)
  const passwordInvalid = passwordChanged && password.length < PASSWORD_MIN
  const dirty = nameChanged || emailChanged || passwordChanged
  const canSubmit = dirty && !nameInvalid && !emailInvalid && !passwordInvalid && !working

  const movesBackup = emailChanged
  const signedOut = isSelf && (emailChanged || passwordChanged)

  const close = () => {
    if (!working) onClose()
  }

  const onSubmit = async () => {
    if (!canSubmit) return
    const payload: AdminUserUpdateRequest = {}
    if (nameChanged) payload.displayName = trimmedName
    if (emailChanged) payload.email = trimmedEmail
    if (passwordChanged) payload.password = password

    setWorking(true)
    setError(null)
    try {
      const res = await updateAdminUser(user.id, payload)
      onDone({ user: res.user, backup: res.backup, emailChanged, signedOut })
    } catch (err: unknown) {
      setError(httpErrorMessage(err, UPDATE_ERROR_MESSAGES))
      setWorking(false)
    }
  }

  const previewName = trimmedName || user.displayName
  const previewEmail = trimmedEmail || user.email

  return (
    <Dialog
      title={`Edit ${user.displayName}`}
      onClose={close}
      ariaLabel="Edit user account"
      closeOnOverlay={false}
      escapeKey={!working}
      closeDisabled={working}
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-6 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto"
      titleClassName="text-base font-semibold text-on-surface truncate"
      closeClassName="text-outline hover:text-on-surface transition-colors p-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      icon={
        <span className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
          <FaPenToSquare className="text-primary text-base" />
        </span>
      }
    >
      <div className="mt-4 space-y-4">
        {/* Live preview: typing a new name or email updates the card, so the admin sees the
            identity as it will exist after saving. */}
        <div className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2.5">
          <span className="w-8 h-8 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-xs font-bold flex items-center justify-center">
            {(previewName.charAt(0) || '?').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface truncate">{previewName}</p>
            <p className="font-mono text-[11px] text-outline truncate">{previewEmail}</p>
          </div>
          <span className="shrink-0">
            <RoleBadge role={user.role} />
          </span>
        </div>

        <div>
          <label
            htmlFor="edit-user-name"
            className="block text-xs font-medium text-on-surface-variant mb-1.5"
          >
            Name
          </label>
          <input
            id="edit-user-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="off"
            autoFocus
            disabled={working}
            className={formInputClass}
          />
          {nameInvalid && (
            <p className="mt-1.5 text-[11px] text-status-error">Name can't be blank.</p>
          )}
        </div>

        <div>
          <label
            htmlFor="edit-user-email"
            className="block text-xs font-medium text-on-surface-variant mb-1.5"
          >
            Email
          </label>
          <input
            id="edit-user-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            disabled={working}
            className={formInputClass}
          />
          {emailInvalid && (
            <p className="mt-1.5 text-[11px] text-status-error">Enter a valid email address.</p>
          )}
        </div>

        {movesBackup && !working && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">
            <FaDatabase className="mt-0.5 shrink-0 text-outline" aria-hidden="true" />
            <span>
              Changing the email also moves this account's S3 backup to the new address. A large
              library can take a few minutes.
            </span>
          </p>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <label
              htmlFor="edit-user-password"
              className="block text-xs font-medium text-on-surface-variant"
            >
              New password
            </label>
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Optional
            </span>
          </div>
          <input
            id="edit-user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current password"
            autoComplete="new-password"
            disabled={working}
            className={cx(formInputClass, 'placeholder:text-xs')}
          />
          {passwordInvalid ? (
            <p className="mt-1.5 text-[11px] text-status-error">Use at least 8 characters.</p>
          ) : (
            <p className="mt-1.5 text-[11px] text-outline">At least 8 characters.</p>
          )}
        </div>

        {signedOut && !working && (
          <div className="flex items-start gap-2.5 rounded-lg bg-surface-container px-3 py-2.5">
            <FaTriangleExclamation
              className="mt-0.5 shrink-0 text-on-surface-variant"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <StatusPill tone="warn">Your account</StatusPill>
              <p className="mt-1.5 text-xs text-on-surface-variant">
                Changing your own email or password ends this session on every device. You'll need
                to sign in again with the new details.
              </p>
            </div>
          </div>
        )}

        {working && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg bg-surface-container px-3 py-2.5"
          >
            <p className="flex items-center gap-2 text-xs font-medium text-on-surface">
              <FaSpinner className="animate-spin text-primary" aria-hidden="true" />
              {movesBackup ? 'Moving the S3 backup to the new address…' : 'Saving changes…'}
            </p>
            {movesBackup && (
              <p className="mt-1 pl-6 text-[11px] text-on-surface-variant">
                Saving the account, then copying its backup — large libraries can take a few
                minutes. Keep this window open.
              </p>
            )}
            <div
              className="mt-2 h-1 rounded-full bg-surface-container-high overflow-hidden"
              aria-hidden="true"
            >
              <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-status-error/10 px-3 py-2.5 text-xs text-status-error"
          >
            <FaCircleExclamation className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={close}
          disabled={working}
          className="text-sm font-medium text-on-surface-variant hover:text-on-surface rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-container px-3 py-2 text-sm font-medium text-on-primary-container shadow-sm transition-colors hover:bg-primary-container/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {working && <FaSpinner className="animate-spin" aria-hidden="true" />}
          {working ? 'Updating…' : 'Save changes'}
        </button>
      </div>
    </Dialog>
  )
}
