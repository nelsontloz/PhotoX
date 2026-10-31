import { useState } from 'react';
import { FaCircleExclamation, FaSpinner, FaUserPlus } from 'react-icons/fa6';
import type { AdminUserCreateRequest, AdminUserRow, Role } from '@photox/shared-types';
import { Dialog, formInputClass } from '../../components/Dialog';
import { createAdminUser } from '../../api/admin';
import { cx } from './ui';
import { emailLooksValid } from './shared';
import { httpErrorMessage, type HttpErrorMessages } from './http-error';

// --- create account dialog ---------------------------------------------------------------
// Admin-created accounts work whether or not public sign-ups are open. Same field language as
// EditUserDialog; the submit button stays disabled until every field is usable.

const PASSWORD_MIN = 8;
const NAME_MAX = 64;

/** Never leak axios verbatim; the server statuses map to plain sentences. */
export const CREATE_ERROR_MESSAGES: HttpErrorMessages = {
  fallback: 'Create failed. Try again.',
  byStatus: {
    409: 'That email is already registered.',
    400: ({ text }) => text.trim() || 'Check the fields and try again.',
    403: 'Only an admin can do that.',
  },
  preferServerMessage: true,
};

export function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: AdminUserRow) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const nameMissing = trimmedName.length === 0;
  const emailInvalid = trimmedEmail.length > 0 && !emailLooksValid(trimmedEmail);
  const passwordShort = password.length > 0 && password.length < PASSWORD_MIN;
  const canSubmit =
    !nameMissing && emailLooksValid(trimmedEmail) && password.length >= PASSWORD_MIN && !working;

  const close = () => {
    if (!working) onClose();
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    const payload: AdminUserCreateRequest = {
      displayName: trimmedName,
      email: trimmedEmail,
      password,
      role,
    };
    setWorking(true);
    setError(null);
    try {
      onCreated(await createAdminUser(payload));
    } catch (err: unknown) {
      setError(httpErrorMessage(err, CREATE_ERROR_MESSAGES));
      setWorking(false);
    }
  };

  return (
    <Dialog
      title="New user"
      onClose={close}
      ariaLabel="Create user account"
      closeOnOverlay={false}
      escapeKey={!working}
      closeDisabled={working}
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-6 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto"
      titleClassName="text-base font-semibold text-on-surface truncate"
      closeClassName="text-outline hover:text-on-surface transition-colors p-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      icon={
        <span className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
          <FaUserPlus className="text-primary text-base" />
        </span>
      }
    >
      <div className="mt-4 space-y-4">
        <div>
          <label
            htmlFor="create-user-name"
            className="block text-xs font-medium text-on-surface-variant mb-1.5"
          >
            Name
          </label>
          <input
            id="create-user-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="off"
            autoFocus
            disabled={working}
            className={formInputClass}
          />
        </div>

        <div>
          <label
            htmlFor="create-user-email"
            className="block text-xs font-medium text-on-surface-variant mb-1.5"
          >
            Email
          </label>
          <input
            id="create-user-email"
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

        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <label
              htmlFor="create-user-password"
              className="block text-xs font-medium text-on-surface-variant"
            >
              Password
            </label>
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Required
            </span>
          </div>
          <input
            id="create-user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            disabled={working}
            className={cx(formInputClass, 'placeholder:text-xs')}
          />
          {passwordShort && (
            <p className="mt-1.5 text-[11px] text-status-error">Use at least 8 characters.</p>
          )}
        </div>

        <div>
          <label
            htmlFor="create-user-role"
            className="block text-xs font-medium text-on-surface-variant mb-1.5"
          >
            Role
          </label>
          <select
            id="create-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={working}
            className={formInputClass}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <p className="mt-1.5 text-[11px] text-outline">
            Admins can manage users, backups and pipeline settings.
          </p>
        </div>

        {working && (
          <p role="status" className="flex items-center gap-2 text-xs text-on-surface-variant">
            <FaSpinner className="animate-spin" aria-hidden="true" />
            Creating the account…
          </p>
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
          {working ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </Dialog>
  );
}
