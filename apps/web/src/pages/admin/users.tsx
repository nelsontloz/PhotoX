import { useEffect, useState } from 'react';
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsRotate,
  FaArrowsUpDown,
  FaCircleExclamation,
  FaDatabase,
  FaMagnifyingGlass,
  FaPenToSquare,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
  FaUserPlus,
  FaUserShield,
} from 'react-icons/fa6';
import { type AdminUserRow, type AdminUserSortField } from '@photox/shared-types';
import { LoadingState } from '../../components/StateViews';
import { Dialog, formInputClass } from '../../components/Dialog';
import { useAuthStore } from '../../store/auth-store';
import { AdminCard, AdminSection, AdminToast, Button, StatusPill, cx } from './ui';
import {
  deleteAdminUser,
  getRegistrationSettings,
  listAdminUsers,
  pollAdminUserDelete,
  setRegistrationSettings,
  syncAdminUserBackup,
  type ListAdminUsersParams,
} from '../../api/admin';
import { RoleBadge } from './shared';
import {
  EditUserDialog,
  BACKUP_RETRY_ERROR_MESSAGES,
  type UserEditOutcome,
} from './edit-user-dialog';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';
import { httpErrorMessage, type HttpErrorMessages } from './http-error';
import { CreateUserDialog } from './create-user-dialog';

// --- users ------------------------------------------------------------------------------

type SortDir = 'asc' | 'desc';

interface SortState {
  field: AdminUserSortField;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' };
const DEFAULT_LIMIT = 20;

const SELF_DELETE_GUARD = "You can't delete your own account.";
const LAST_ADMIN_GUARD = "The last admin can't be deleted.";
const GENERIC_COUNTS = 'Their photos, videos, albums and shares will be permanently removed.';

/** Never leak axios verbatim; the server guards map to plain sentences. */
const DELETE_ERROR_MESSAGES: HttpErrorMessages = {
  fallback: 'Delete failed. Try again.',
  byStatus: {
    403: ({ text }) => text || SELF_DELETE_GUARD,
    409: ({ text }) => text || LAST_ADMIN_GUARD,
    404: 'That user no longer exists. Close this and refresh the list.',
  },
  preferServerMessage: true,
};

interface SortHeaderProps {
  field: AdminUserSortField;
  label: string;
  sort: SortState;
  onSort: (field: AdminUserSortField) => void;
}

function SortHeader({ field, label, sort, onSort }: SortHeaderProps) {
  const active = sort.field === field;
  const Icon = !active ? FaArrowsUpDown : sort.dir === 'asc' ? FaArrowUp : FaArrowDown;
  return (
    <th className="text-left font-semibold px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1.5 hover:text-on-surface transition-colors"
      >
        {label}
        <Icon className={cx('text-[10px]', active ? 'text-primary' : 'text-outline')} />
      </button>
    </th>
  );
}

// --- delete dialog ----------------------------------------------------------------------
// Owns its layout: identity card up top, impact counts, the S3-kept note, then the typed
// gate and footer. Stays open on failure (error box inline); closes only on success.

function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onDeleted: (displayName: string) => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmText === 'DELETE';
  const close = () => {
    if (!working) onClose();
  };

  const onConfirm = async () => {
    if (!confirmed || working) return;
    setWorking(true);
    setError(null);
    try {
      await deleteAdminUser(user.id);
      await pollAdminUserDelete(user.id);
      onDeleted(user.displayName);
    } catch (err: unknown) {
      setError(httpErrorMessage(err, DELETE_ERROR_MESSAGES));
      setWorking(false);
    }
  };

  return (
    <Dialog
      title={`Delete ${user.displayName}?`}
      onClose={close}
      ariaLabel="Delete user confirmation"
      closeOnOverlay={false}
      escapeKey={!working}
      closeDisabled={working}
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-6 max-w-lg w-full"
      titleClassName="text-base font-semibold text-slate-100"
      icon={
        <span className="w-9 h-9 shrink-0 rounded-lg bg-status-error/10 flex items-center justify-center">
          <FaTriangleExclamation className="text-status-error text-base" />
        </span>
      }
    >
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2.5">
          <span className="w-8 h-8 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-xs font-bold flex items-center justify-center">
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface truncate">{user.displayName}</p>
            <p className="font-mono text-[11px] text-outline truncate">{user.email}</p>
          </div>
          <RoleBadge role={user.role} />
        </div>

        <p className="text-sm text-slate-300">{GENERIC_COUNTS}</p>

        <p className="flex items-start gap-2 rounded-lg bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">
          <FaDatabase className="mt-0.5 shrink-0 text-outline" aria-hidden="true" />
          <span>S3 backup is kept — only the live account and its library are removed.</span>
        </p>

        <div>
          <label
            htmlFor="delete-user-confirm"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            id="delete-user-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            autoFocus
            disabled={working}
            className={cx(formInputClass, 'font-mono tracking-widest')}
          />
        </div>

        {working && (
          <p role="status" className="flex items-center gap-2 text-xs text-on-surface-variant">
            <FaSpinner className="animate-spin" aria-hidden="true" />
            Removing user… this can take a moment.
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
        <Button variant="secondary" size="lg" onClick={close} disabled={working}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={!confirmed || working}
          className="inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-status-error/90 hover:bg-status-error rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {working && <FaSpinner className="animate-spin" aria-hidden="true" />}
          {working ? 'Deleting…' : 'Delete user'}
        </button>
      </div>
    </Dialog>
  );
}

// --- post-edit backup warning ------------------------------------------------------------
// An email edit relocates the S3 backup inline. When storage is unreachable the account edit
// still stands and only the move failed, so the dialog closes (its job is done) and this box
// stays put until the move lands or the admin dismisses it. The storage error is shown
// verbatim — it is the one detail the admin can act on.

interface BackupMoveWarning {
  userId: string;
  displayName: string;
  email: string;
  to: string;
  error: string;
  /** An email change wants the whole prefix relocated; any other edit only syncs the manifest. */
  emailChanged: boolean;
}

function BackupMoveWarningBox({
  warning,
  retrying,
  onRetry,
  onDismiss,
}: {
  warning: BackupMoveWarning;
  retrying: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-status-error/40 bg-status-error/10 p-3 sm:p-4"
    >
      <div className="flex items-start gap-2.5">
        <FaCircleExclamation className="mt-0.5 shrink-0 text-status-error" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-on-surface">
            {warning.emailChanged
              ? `${warning.displayName}'s account was updated, but the S3 backup was not moved.`
              : `${warning.displayName}'s account was updated, but its S3 backup was left behind.`}
          </p>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            {warning.emailChanged
              ? `The account, library, albums and shares are all on ${warning.email}. Only the backup copy is still under the old address.`
              : 'The live account, library and shares are current; the backup copy on S3 still holds the old details.'}
          </p>
          {warning.emailChanged && (
            <p className="mt-1.5 break-all font-mono text-[10px] text-outline">
              Target: {warning.to}
            </p>
          )}
          <p className="mt-1.5 break-words rounded-lg bg-surface-container px-2.5 py-2 font-mono text-[10px] text-status-error">
            {warning.error}
          </p>
          {retrying && (
            <p
              role="status"
              className="mt-2 flex items-center gap-2 text-[11px] text-on-surface-variant"
            >
              <FaSpinner className="animate-spin" aria-hidden="true" />
              Moving the backup — this can take a few minutes.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-container px-2.5 py-1.5 text-[11px] font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaArrowsRotate className="text-[11px]" aria-hidden="true" />
              Retry move
            </button>
            <Button variant="secondary" size="sm" onClick={onDismiss} disabled={retrying}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- registration settings ---------------------------------------------------------------
// One global switch, saved on toggle: it flips optimistically and reverts with the error
// inline when the PATCH fails. Admin-created accounts are unaffected either way.

const REGISTRATION_ERROR_MESSAGES: HttpErrorMessages = {
  fallback: "Couldn't save the sign-up setting. Try again.",
  byStatus: { 403: 'Only an admin can change this.' },
  timeout: "Couldn't reach the server — the setting was not changed.",
  preferServerMessage: true,
};

function RegistrationSettingsCard() {
  const { data, loading, error, setData, refresh } = useAsyncFetch(getRegistrationSettings, {
    errorMessage: "Couldn't load the sign-up setting.",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const enabled = data?.enabled ?? false;

  const toggle = async () => {
    if (saving || !data) return;
    const next = !data.enabled;
    setSaving(true);
    setSaveError(null);
    setData({ enabled: next });
    try {
      setData(await setRegistrationSettings(next));
    } catch (err: unknown) {
      setData({ enabled: !next });
      setSaveError(httpErrorMessage(err, REGISTRATION_ERROR_MESSAGES));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard className="mb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="registration-switch-label" className="text-sm font-semibold text-on-surface">
            Allow public sign-ups
          </h3>
          <p className="mt-1 max-w-xl text-xs text-on-surface-variant">
            When off, the public sign-up page is closed. Accounts you create here still work.
          </p>
          {saveError && (
            <p role="alert" className="mt-2 text-xs text-status-error">
              {saveError}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-status-error">
              {error}
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saving && (
            <span
              role="status"
              className="font-mono text-[10px] uppercase tracking-wider text-outline"
            >
              Saving…
            </span>
          )}
          {loading ? (
            <span role="status" className="text-outline">
              <FaSpinner className="animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading sign-up setting…</span>
            </span>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby="registration-switch-label"
              disabled={saving || data == null}
              onClick={() => void toggle()}
              className={cx(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low',
                enabled ? 'bg-primary' : 'bg-surface-container-highest',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                  enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
              />
            </button>
          )}
        </div>
      </div>
    </AdminCard>
  );
}

export function UsersSection() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [backupWarning, setBackupWarning] = useState<BackupMoveWarning | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQ, sort]);

  const { data, loading, error } = useAsyncFetch(
    () => {
      const params: ListAdminUsersParams = {
        limit: DEFAULT_LIMIT,
        offset,
        sortField: sort.field,
        sortDir: sort.dir,
      };
      if (debouncedQ) params.q = debouncedQ;
      return listAdminUsers(params);
    },
    {
      // Any filter/page change (or an explicit refresh bump) is a new request key.
      refreshKey: `${debouncedQ}|${sort.field}|${sort.dir}|${offset}|${version}`,
      errorMessage: 'Failed to load users',
      loadingMode: 'always',
    },
  );

  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / DEFAULT_LIMIT) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_LIMIT));
  const items = data?.items ?? [];
  const adminCount = items.filter((u) => u.role === 'admin').length;
  // The last-admin guard only applies when the whole directory fits on this page;
  // anything paged out stays the server's call (409 surfaces in the dialog).
  const fullyLoaded = items.length > 0 && total <= items.length;

  const guardFor = (u: AdminUserRow): string | null => {
    if (currentUserId != null && u.id === currentUserId) return SELF_DELETE_GUARD;
    if (u.role === 'admin' && adminCount === 1 && fullyLoaded) return LAST_ADMIN_GUARD;
    return null;
  };

  // Editing is never blocked by the delete guards (self and last-admin are delete-only), but a
  // backup move already in flight for a row would put a stale identity in the dialog.
  const editGuardFor = (u: AdminUserRow): string | null =>
    retryingId === u.id ? "Moving this user's S3 backup — wait for it to finish." : null;

  /** A save is done: the row is live, so refresh the list and report the backup outcome. */
  const onEdited = (outcome: UserEditOutcome) => {
    const { user: updated, backup, emailChanged, signedOut } = outcome;
    setEditing(null);
    setVersion((v) => v + 1);

    // Applied, but storage refused the sync: the failure lives outside the dialog so it
    // survives until the admin actually retries it.
    if (!backup.synced && backup.reason !== 'no-backup') {
      setBackupWarning({
        userId: updated.id,
        displayName: updated.displayName,
        email: updated.email,
        to: backup.to,
        error: backup.error ?? 'The backup store did not respond.',
        emailChanged,
      });
      return;
    }

    if (signedOut) {
      // Every session for this user was revoked — including this one. The next API call
      // fails its refresh and the app returns to the sign-in screen.
      setNotice({ id: Date.now(), text: 'Your account was updated — sign in again.' });
      return;
    }

    const backupNote = !emailChanged
      ? ''
      : backup.reason === 'no-backup'
        ? ' No S3 backup found, so nothing was moved.'
        : backup.moved
          ? ' S3 backup moved to the new address.'
          : ' S3 backup was already at the new address.';
    setNotice({ id: Date.now(), text: `Updated ${updated.displayName}.${backupNote}` });
  };

  const retryBackupMove = async () => {
    const warning = backupWarning;
    if (!warning || retryingId != null) return;
    setRetryingId(warning.userId);
    try {
      const res = await syncAdminUserBackup(warning.userId);
      if (res.synced) {
        setBackupWarning(null);
        setNotice({
          id: Date.now(),
          text: res.moved
            ? `S3 backup moved for ${warning.email}.`
            : `Backup for ${warning.email} is up to date.`,
        });
        return;
      }
      if (res.reason === 'no-backup') {
        setBackupWarning(null);
        setNotice({
          id: Date.now(),
          text: `No S3 backup found for ${warning.email} — nothing to move.`,
        });
        return;
      }
      // Still no storage: keep the box up with the freshest detail.
      setBackupWarning((prev) =>
        prev ? { ...prev, to: res.to, error: res.error ?? prev.error } : prev,
      );
    } catch (err: unknown) {
      setBackupWarning((prev) =>
        prev ? { ...prev, error: httpErrorMessage(err, BACKUP_RETRY_ERROR_MESSAGES) } : prev,
      );
    } finally {
      setRetryingId(null);
    }
  };

  const onSort = (field: AdminUserSortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { field, dir: field === 'createdAt' || field === 'email' ? 'desc' : 'asc' };
    });
  };

  return (
    <AdminSection
      card={false}
      title="Users Management"
      subtitle="Manage accounts on this instance"
      icon={
        <span className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center">
          <FaUserShield className="text-primary text-sm" />
        </span>
      }
      actions={
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={() => setCreating(true)}
            icon={<FaUserPlus className="text-xs" aria-hidden="true" />}
          >
            New user
          </Button>
          <StatusPill tone="warn">Admin only</StatusPill>
          <div className="relative w-full sm:w-72">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xs" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users"
              className="w-full bg-surface-container border border-border-dark focus:border-primary/50 focus:ring-1 focus:ring-primary outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-on-surface placeholder-outline transition-colors"
            />
          </div>
        </div>
      }
    >
      {backupWarning && (
        <BackupMoveWarningBox
          warning={backupWarning}
          retrying={retryingId != null}
          onRetry={() => void retryBackupMove()}
          onDismiss={() => setBackupWarning(null)}
        />
      )}

      <RegistrationSettingsCard />

      {loading ? (
        <LoadingState className="flex items-center justify-center py-24" />
      ) : error ? (
        <AdminCard className="text-center">
          <p className="text-sm text-status-error mb-3">{error}</p>
          <Button variant="ghost" onClick={() => setVersion((v) => v + 1)}>
            Retry
          </Button>
        </AdminCard>
      ) : items.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <p className="text-on-surface-variant">No users match the current filters.</p>
        </AdminCard>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface-container-low">
          <table className="w-full text-xs">
            <thead className="bg-surface-container text-on-surface-variant font-mono text-label-xs uppercase tracking-wider">
              <tr>
                <SortHeader field="displayName" label="User" sort={sort} onSort={onSort} />
                <SortHeader field="email" label="Email" sort={sort} onSort={onSort} />
                <SortHeader field="role" label="Role" sort={sort} onSort={onSort} />
                <SortHeader field="createdAt" label="Created" sort={sort} onSort={onSort} />
                <th className="text-right font-semibold px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {items.map((u) => {
                const guard = guardFor(u);
                const editGuard = editGuardFor(u);
                return (
                  <tr key={u.id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-[11px] font-bold flex items-center justify-center">
                          {u.displayName.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="text-on-surface font-medium truncate">{u.displayName}</p>
                          <p className="font-mono text-[10px] text-outline truncate">{u.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-on-surface-variant">{u.email}</td>
                    <td className="py-3.5 px-4">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-outline">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      {/* Destructive stays last: Edit reads as the neutral action, Delete as
                          the one that removes the account. */}
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          tone="accent"
                          onClick={() => setEditing(u)}
                          disabled={editGuard != null}
                          title={editGuard ?? `Edit ${u.displayName}`}
                          ariaLabel={`Edit ${u.displayName}`}
                          icon={<FaPenToSquare className="text-xs" aria-hidden="true" />}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setTarget(u)}
                          disabled={guard != null}
                          title={guard ?? `Delete ${u.displayName}`}
                          ariaLabel={`Delete ${u.displayName}`}
                          icon={<FaTrashCan className="text-xs" aria-hidden="true" />}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <footer className="bg-surface-container px-4 py-3 flex items-center justify-between text-xs text-outline font-mono">
            <span>Showing {total.toLocaleString()} registered user(s)</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
              >
                Prev
              </Button>
              <span className="px-2 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + DEFAULT_LIMIT)}
              >
                Next
              </Button>
            </div>
          </footer>
        </div>
      )}

      {notice && <AdminToast key={notice.id} message={notice.text} />}

      {editing && (
        <EditUserDialog
          user={editing}
          isSelf={currentUserId != null && editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onDone={onEdited}
        />
      )}

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(user) => {
            setCreating(false);
            setNotice({ id: Date.now(), text: `Created ${user.displayName}.` });
            setVersion((v) => v + 1);
          }}
        />
      )}

      {target && (
        <DeleteUserDialog
          user={target}
          onClose={() => setTarget(null)}
          onDeleted={(displayName) => {
            setTarget(null);
            setNotice({ id: Date.now(), text: `Deleted ${displayName}.` });
            setVersion((v) => v + 1);
          }}
        />
      )}
    </AdminSection>
  );
}
