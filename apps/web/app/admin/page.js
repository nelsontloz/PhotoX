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
import AppSidebar from "../components/app-sidebar";

function estimateStorageGb(uploadCount) {
  return Math.max(1, Math.round((uploadCount || 0) * 3.6));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function initialsFromEmail(email) {
  const localPart = (email || "").split("@")[0] || "user";
  const chunks = localPart
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase());

  if (chunks.length >= 2) {
    return `${chunks[0]}${chunks[1]}`;
  }

  const compact = localPart.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length >= 2) {
    return compact.slice(0, 2).toUpperCase();
  }

  return "UX";
}

function rolePillClass(isAdmin) {
  return isAdmin
    ? "border border-cyan-200 bg-cyan-50 text-cyan-700"
    : "border border-slate-200 bg-slate-100 text-slate-600";
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
  const [userFilter, setUserFilter] = useState("");
  const [isCreateFormVisible, setIsCreateFormVisible] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  const filteredUsers = useMemo(() => {
    const normalizedFilter = userFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return users;
    }

    return users.filter((item) => item.user.email.toLowerCase().includes(normalizedFilter));
  }, [userFilter, users]);

  const totalStorageGb = useMemo(
    () => users.reduce((sum, item) => sum + estimateStorageGb(item.uploadCount), 0),
    [users]
  );

  const activeUsersCount = useMemo(
    () => users.filter((item) => item.user.isActive).length,
    [users]
  );

  const storagePercent = clampPercent((totalStorageGb / 4000) * 100);

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
    <div className="relative flex h-[calc(100vh-61px)] overflow-hidden bg-[#f8fbfc] text-[#0d181b]" style={{ fontFamily: "'Space Grotesk', var(--font-manrope), sans-serif" }}>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap");

        .admin-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .admin-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .admin-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .admin-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>

      {isSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-[61px] left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:inset-auto lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AppSidebar activeLabel="Admin" />
      </aside>

      <main className="admin-scroll flex min-w-0 flex-1 justify-center overflow-y-auto px-4 py-5 md:px-8 lg:px-12 xl:px-16">
        <div className="flex w-full max-w-[1200px] flex-col gap-8">
          <header className="flex items-center justify-between border-b border-[#e7f0f3] pb-5">
            <div className="flex items-center gap-3">
              <button type="button" className="rounded-lg p-2 hover:bg-white lg:hidden" onClick={() => setIsSidebarOpen(true)}>
                Menu
              </button>
              <div className="flex items-center gap-3 text-[#0d181b]">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-600">PX</div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    PhotoX <span className="font-normal text-[#4c869a]">Admin</span>
                  </h2>
                  <p className="text-xs text-[#4c869a]">User and access operations</p>
                </div>
              </div>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <div className="rounded-lg border border-[#e7f0f3] bg-white px-3 py-2 text-sm font-medium text-[#4c869a]">{sessionUser.email}</div>
            </div>
          </header>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[#0d181b]">User Management</h1>
              <p className="mt-1 text-sm text-[#4c869a]">Manage user access, roles, and monitor upload activity.</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-[#13b6ec] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-300/30 transition hover:bg-[#0e8db9]"
              onClick={() => setIsCreateFormVisible((value) => !value)}
            >
              <span>+</span>
              <span>{isCreateFormVisible ? "Hide Form" : "Add New User"}</span>
            </button>
          </div>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{errorMessage}</div>
          ) : null}

          {isCreateFormVisible ? (
            <form
              className="grid gap-3 rounded-xl border border-[#e7f0f3] bg-white p-4 shadow-sm md:grid-cols-[2fr_2fr_auto_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate();
              }}
            >
              <input
                className="h-11 rounded-lg border border-[#e7f0f3] px-3 text-sm text-[#0d181b] outline-none transition focus:border-[#13b6ec] focus:ring-2 focus:ring-cyan-100"
                type="email"
                placeholder="user@example.com"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                required
              />
              <input
                className="h-11 rounded-lg border border-[#e7f0f3] px-3 text-sm text-[#0d181b] outline-none transition focus:border-[#13b6ec] focus:ring-2 focus:ring-cyan-100"
                type="password"
                placeholder="Temporary password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                minLength={8}
                required
              />
              <label className="inline-flex items-center gap-2 rounded-lg border border-[#e7f0f3] bg-[#f8fbfc] px-3 text-sm font-semibold text-[#0d181b]">
                <input type="checkbox" checked={newUserAdmin} onChange={(event) => setNewUserAdmin(event.target.checked)} />
                Admin
              </label>
              <button
                type="submit"
                className="rounded-lg bg-[#13b6ec] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0e8db9] disabled:cursor-not-allowed disabled:opacity-70"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create User"}
              </button>
            </form>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-xl border border-[#e7f0f3] bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4c869a]">Total Users</p>
              <div className="flex items-end justify-between">
                <p className="text-4xl font-bold text-[#0d181b]">{users.length}</p>
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600">{activeUsersCount} active</span>
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-xl border border-[#e7f0f3] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4c869a]">Storage Used</p>
                <p className="text-sm font-bold text-[#0d181b]">
                  {(totalStorageGb / 1000).toFixed(2)} TB <span className="font-normal text-[#4c869a]">/ 4 TB</span>
                </p>
              </div>
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-[#13b6ec]" style={{ width: `${storagePercent}%` }} />
                </div>
                <p className="mt-2 text-xs text-[#4c869a]">Estimated from total upload counts</p>
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-xl border border-[#e7f0f3] bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4c869a]">System Health</p>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                <p className="text-2xl font-bold text-[#0d181b]">Operational</p>
              </div>
              <p className="text-xs font-medium text-emerald-600">Admin API reachable and session verified</p>
            </article>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 rounded-lg border border-[#e7f0f3] bg-white p-2 shadow-sm sm:flex-row">
            <div className="relative w-full sm:w-80">
              <input
                className="block h-11 w-full rounded-md border border-[#e7f0f3] bg-transparent px-3 text-sm text-[#0d181b] outline-none transition focus:border-[#13b6ec] focus:ring-2 focus:ring-cyan-100"
                placeholder="Search users by email..."
                type="text"
                value={userFilter}
                onChange={(event) => setUserFilter(event.target.value)}
              />
            </div>

            <div className="flex w-full gap-2 sm:w-auto">
              <button type="button" className="flex-1 rounded-md border border-[#e7f0f3] bg-[#f8fbfc] px-4 py-2 text-sm font-medium text-[#4c869a] sm:flex-none">
                Filter
              </button>
              <button type="button" className="flex-1 rounded-md border border-[#e7f0f3] bg-[#f8fbfc] px-4 py-2 text-sm font-medium text-[#4c869a] sm:flex-none">
                Sort
              </button>
            </div>
          </div>

          <div className="w-full overflow-hidden rounded-xl border border-[#e7f0f3] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e7f0f3] bg-[#f8fbfc]">
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#4c869a]">User</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#4c869a]">Role</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#4c869a]">Storage Used</th>
                    <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-wider text-[#4c869a]">Status</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-[#4c869a]">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#e7f0f3]">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-sm font-medium text-[#4c869a]">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((item) => {
                      const isSelf = item.user.id === sessionUser.id;
                      const storageGb = estimateStorageGb(item.uploadCount);
                      const storageQuotaGb = 1000;
                      const storageRatio = clampPercent((storageGb / storageQuotaGb) * 100);

                      return (
                        <tr key={item.user.id} className="transition-colors hover:bg-[#f8fbfc]">
                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex items-center">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 to-sky-100 text-sm font-bold text-cyan-700">
                                {initialsFromEmail(item.user.email)}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-bold text-[#0d181b]">{item.user.email.split("@")[0]}</div>
                                <div className="text-xs text-[#4c869a]">{item.user.email}</div>
                              </div>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4">
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${rolePillClass(item.user.isAdmin)}`}
                              onClick={() => onToggleAdmin(item.user.id, !item.user.isAdmin, isSelf)}
                            >
                              {item.user.isAdmin ? "Admin" : "User"}
                            </button>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex w-full max-w-[220px] flex-col gap-1.5">
                              <div className="flex justify-between text-xs font-medium text-[#0d181b]">
                                <span>{storageGb} GB</span>
                                <span className="text-[#4c869a]">{storageRatio}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className={`h-1.5 rounded-full ${storageRatio > 85 ? "bg-red-500" : "bg-[#13b6ec]"}`}
                                  style={{ width: `${storageRatio}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4 text-center">
                            <label className="relative inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                className="peer sr-only"
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
                              <span className="h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-[#13b6ec]" />
                              <span className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                            </label>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                className="h-9 w-48 rounded-md border border-[#e7f0f3] px-3 text-xs text-[#0d181b] outline-none transition focus:border-[#13b6ec] focus:ring-2 focus:ring-cyan-100"
                                type="password"
                                placeholder="Reset password"
                                minLength={8}
                                value={resetPasswordByUserId[item.user.id] || ""}
                                onChange={(event) =>
                                  setResetPasswordByUserId((prev) => ({
                                    ...prev,
                                    [item.user.id]: event.target.value
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="rounded-md border border-[#e7f0f3] bg-[#f8fbfc] px-3 py-2 text-xs font-bold text-[#4c869a] transition hover:border-[#13b6ec] hover:text-[#0d181b]"
                                onClick={() => onResetPassword(item.user.id)}
                              >
                                Reset
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-[#e7f0f3] bg-white px-6 py-3">
              <p className="text-sm text-[#4c869a]">
                Showing <span className="font-semibold text-[#0d181b]">{filteredUsers.length === 0 ? 0 : 1}</span> to{" "}
                <span className="font-semibold text-[#0d181b]">{filteredUsers.length}</span> of{" "}
                <span className="font-semibold text-[#0d181b]">{users.length}</span> results
              </p>
              <div className="flex gap-2">
                <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500">
                  Prev
                </button>
                <button type="button" className="rounded-md bg-[#13b6ec] px-3 py-1.5 text-sm font-semibold text-white">
                  1
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
