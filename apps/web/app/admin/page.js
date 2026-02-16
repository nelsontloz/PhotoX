"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import {
  createAdminManagedUser,
  disableAdminManagedUser,
  fetchCurrentUser,
  formatApiError,
  listAdminUsers,
  resetAdminManagedUserPassword,
  updateAdminManagedUser
} from "../../lib/api";

function EmptyState() {
  return <p className="text-sm text-ocean-700">No users found.</p>;
}

export default function AdminPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserAdmin, setNewUserAdmin] = useState(false);
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState({});

  async function refreshUsers() {
    const payload = await listAdminUsers({ limit: 100, offset: 0 });
    setUsers(payload.items || []);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const mePayload = await fetchCurrentUser();
        if (cancelled) {
          return;
        }

        setSessionUser(mePayload.user);
        if (!mePayload.user?.isAdmin) {
          router.replace("/upload");
          return;
        }

        await refreshUsers();
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(formatApiError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const createMutation = useMutation({
    mutationFn: () =>
      createAdminManagedUser({
        email: newUserEmail,
        password: newUserPassword,
        isAdmin: newUserAdmin
      }),
    onSuccess: async () => {
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserAdmin(false);
      setErrorMessage("");
      await refreshUsers();
    },
    onError: (error) => setErrorMessage(formatApiError(error))
  });

  const activeAdminCount = useMemo(
    () => users.filter((item) => item.user.isAdmin && item.user.isActive).length,
    [users]
  );

  async function onToggleAdmin(userId, nextValue, isSelf) {
    if (isSelf && !nextValue) {
      setErrorMessage("You cannot remove your own admin role (ADMIN_SELF_DEMOTE_FORBIDDEN)");
      return;
    }

    try {
      await updateAdminManagedUser(userId, { isAdmin: nextValue });
      await refreshUsers();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(formatApiError(error));
    }
  }

  async function onToggleActive(userId, nextValue, isSelf, isTargetAdmin, isTargetActive) {
    if (isSelf && !nextValue) {
      setErrorMessage("You cannot disable your own account (ADMIN_SELF_DISABLE_FORBIDDEN)");
      return;
    }

    if (!nextValue && isTargetAdmin && isTargetActive && activeAdminCount <= 1) {
      setErrorMessage("At least one active admin is required (ADMIN_LAST_ACTIVE_FORBIDDEN)");
      return;
    }

    try {
      if (!nextValue) {
        await disableAdminManagedUser(userId);
      } else {
        await updateAdminManagedUser(userId, { isActive: true });
      }
      await refreshUsers();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(formatApiError(error));
    }
  }

  async function onResetPassword(userId) {
    const nextPassword = resetPasswordByUserId[userId] || "";
    if (nextPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters (VALIDATION_ERROR)");
      return;
    }

    try {
      await resetAdminManagedUserPassword(userId, nextPassword);
      setResetPasswordByUserId((prev) => ({ ...prev, [userId]: "" }));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(formatApiError(error));
    }
  }

  if (loading) {
    return (
      <main className="shell py-10">
        <section className="panel p-8">
          <p className="text-ocean-700">Loading admin workspace...</p>
        </section>
      </main>
    );
  }

  if (!sessionUser?.isAdmin) {
    return (
      <main className="shell py-10">
        <section className="panel p-8">
          <p className="error">Admin access is required.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell py-10">
      <section className="panel p-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ocean-500">Admin</p>
        <h1 className="text-3xl font-black tracking-tight text-ocean-900">User management</h1>
        <p className="mt-2 text-sm text-ocean-700">
          Manage account access, admin roles, and upload activity across users.
        </p>

        {errorMessage ? <p className="error mt-4">{errorMessage}</p> : null}

        <form
          className="mt-6 grid gap-3 rounded-xl border border-[#d5e2e8] bg-white p-4 md:grid-cols-[2fr_2fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <input
            className="field"
            type="email"
            placeholder="user@example.com"
            value={newUserEmail}
            onChange={(event) => setNewUserEmail(event.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            placeholder="Temporary password"
            value={newUserPassword}
            onChange={(event) => setNewUserPassword(event.target.value)}
            minLength={8}
            required
          />
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ocean-800">
            <input
              type="checkbox"
              checked={newUserAdmin}
              onChange={(event) => setNewUserAdmin(event.target.checked)}
            />
            Admin
          </label>
          <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create user"}
          </button>
        </form>

        <div className="mt-6 overflow-x-auto">
          {users.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#d5e2e8] text-left text-ocean-700">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Uploads</th>
                  <th className="py-2 pr-4">Reset password</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => {
                  const isSelf = item.user.id === sessionUser.id;
                  return (
                    <tr key={item.user.id} className="border-b border-[#e4edf2] align-top">
                      <td className="py-3 pr-4 font-medium text-ocean-900">{item.user.email}</td>
                      <td className="py-3 pr-4">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={item.user.isAdmin}
                            onChange={(event) => onToggleAdmin(item.user.id, event.target.checked, isSelf)}
                          />
                          <span className="text-ocean-800">Admin</span>
                        </label>
                      </td>
                      <td className="py-3 pr-4">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={item.user.isActive}
                            onChange={(event) =>
                              onToggleActive(
                                item.user.id,
                                event.target.checked,
                                isSelf,
                                item.user.isAdmin,
                                item.user.isActive
                              )
                            }
                          />
                          <span className="text-ocean-800">Active</span>
                        </label>
                      </td>
                      <td className="py-3 pr-4 text-ocean-800">{item.uploadCount}</td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-2">
                          <input
                            className="field w-56"
                            type="password"
                            placeholder="New password"
                            minLength={8}
                            value={resetPasswordByUserId[item.user.id] || ""}
                            onChange={(event) =>
                              setResetPasswordByUserId((prev) => ({
                                ...prev,
                                [item.user.id]: event.target.value
                              }))
                            }
                          />
                          <button type="button" className="btn btn-secondary" onClick={() => onResetPassword(item.user.id)}>
                            Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
