"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import {
  createAdminManagedUser,
  disableAdminManagedUser,
  fetchCurrentUser,
  fetchWorkerTelemetrySnapshot,
  formatApiError,
  listAdminUsers,
  openWorkerTelemetryStream,
  resetAdminManagedUserPassword,
  updateAdminManagedUser
} from "../../lib/api";
import { countActiveAdmins } from "../../lib/admin-metrics";
import { buildLoginPath } from "../../lib/navigation";
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
  const [workerTelemetry, setWorkerTelemetry] = useState(null);
  const [workerStreamStatus, setWorkerStreamStatus] = useState("connecting");

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
          router.replace("/timeline");
          return;
        }

        await refreshUsers();
      } catch (error) {
        if (!cancelled) {
          const message = formatApiError(error);
          if (message.includes("AUTH_REQUIRED") || message.includes("AUTH_TOKEN")) {
            router.replace(buildLoginPath("/admin"));
            return;
          }

          setErrorMessage(message);
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

  useEffect(() => {
    if (!sessionUser?.isAdmin) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let streamSubscription = null;

    const clearTimers = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const loadSnapshot = async () => {
      const snapshot = await fetchWorkerTelemetrySnapshot();
      if (!cancelled) {
        setWorkerTelemetry(snapshot);
      }
    };

    const ensurePollingFallback = () => {
      if (pollTimer || cancelled) {
        return;
      }

      setWorkerStreamStatus("polling");
      loadSnapshot().catch(() => { });
      pollTimer = setInterval(() => {
        loadSnapshot().catch(() => { });
      }, 5000);
    };

    const connectStream = () => {
      if (cancelled) {
        return;
      }

      setWorkerStreamStatus("connecting");
      streamSubscription = openWorkerTelemetryStream({
        onOpen: () => {
          if (cancelled) {
            return;
          }

          reconnectAttempts = 0;
          setWorkerStreamStatus("connected");
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        },
        onMessage: ({ event, payload }) => {
          if (cancelled) {
            return;
          }

          if (event === "state_sync" && payload?.state) {
            setWorkerTelemetry(payload.state);
            return;
          }

          if (event === "event" && payload?.event) {
            setWorkerTelemetry((current) => {
              if (!current) {
                return current;
              }

              const nextEvents = [payload.event, ...(current.recentEvents || [])].slice(0, 120);
              return {
                ...current,
                recentEvents: nextEvents
              };
            });
          }
        },
        onError: () => {
          if (cancelled) {
            return;
          }

          ensurePollingFallback();

          reconnectAttempts += 1;
          const backoffMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
          setWorkerStreamStatus("reconnecting");
          reconnectTimer = setTimeout(() => {
            if (streamSubscription) {
              streamSubscription.close();
              streamSubscription = null;
            }
            connectStream();
          }, backoffMs);
        }
      });
    };

    loadSnapshot().catch(() => {
      ensurePollingFallback();
    });
    connectStream();

    return () => {
      cancelled = true;
      clearTimers();
      if (streamSubscription) {
        streamSubscription.close();
      }
    };
  }, [sessionUser?.isAdmin]);

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
    () => countActiveAdmins(users),
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

  const workerBacklog = useMemo(() => {
    const counts = workerTelemetry?.queueCounts || {};
    return Object.values(counts).reduce(
      (sum, queueCount) => sum + Number(queueCount.waiting || 0) + Number(queueCount.delayed || 0),
      0
    );
  }, [workerTelemetry]);

  const workerInFlight = useMemo(() => Number(workerTelemetry?.inFlightJobs?.length || 0), [workerTelemetry]);

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
        className={`fixed inset-y-[61px] left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:inset-auto lg:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <AppSidebar activeLabel="Admin" isAdmin />
      </aside>

      <main className="admin-scroll flex min-w-0 flex-1 justify-center overflow-y-auto px-4 py-5 md:px-8 lg:px-12 xl:px-16">
        <div className="flex w-full max-w-[1200px] flex-col gap-8">
          <header className="flex items-center justify-between border-b border-[#e7f0f3] pb-5">
            <div className="flex items-center gap-3">
              <button type="button" className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setIsSidebarOpen(true)}>
                <span className="material-symbols-outlined">menu</span>
              </button>
              <div className="flex items-center gap-3 text-[#0d181b]">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-500 text-sm font-bold text-white shadow-lg shadow-cyan-200">
                  <span className="material-symbols-outlined">auto_awesome</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    PhotoX <span className="font-normal text-[#4c869a]">Admin</span>
                  </h2>
                  <p className="text-xs font-medium text-[#4c869a]">User and system operations</p>
                </div>
              </div>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
                <span className="material-symbols-outlined text-base">account_circle</span>
                {sessionUser.email}
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[#0d181b]">User Management</h1>
              <p className="mt-1 text-sm font-medium text-[#4c869a]">Manage user access, roles, and monitor upload activity.</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-200 transition hover:bg-cyan-600"
              onClick={() => setIsCreateFormVisible((value) => !value)}
            >
              <span className="material-symbols-outlined text-xl">
                {isCreateFormVisible ? "close" : "person_add"}
              </span>
              <span>{isCreateFormVisible ? "Close" : "Add New User"}</span>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 md:gap-6">
            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Users</p>
                <span className="material-symbols-outlined text-slate-300">group</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-4xl font-bold text-slate-900">{users.length}</p>
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600 border border-emerald-100">{activeUsersCount} active</span>
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Active Admins</p>
                <span className="material-symbols-outlined text-slate-300">admin_panel_settings</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-4xl font-bold text-slate-900">{activeAdminCount}</p>
                <span className="rounded-lg bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-600 border border-cyan-100">privileged</span>
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Storage Used</p>
                <span className="material-symbols-outlined text-slate-300">database</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">
                  {(totalStorageGb / 1000).toFixed(2)} TB <span className="font-medium text-slate-400">/ 4 TB</span>
                </p>
                <p className="text-xs font-bold text-cyan-600">{storagePercent}%</p>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-sky-500" style={{ width: `${storagePercent}%` }} />
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Worker Status</p>
                <span className="material-symbols-outlined text-slate-300">speed</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-4xl font-bold text-slate-900">{workerBacklog}</p>
                <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-100">{workerInFlight} active</span>
              </div>
            </article>

            <article className="relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">System Health</p>
                <span className={`material-symbols-outlined ${workerStreamStatus === "connected" ? "text-emerald-500" : "text-amber-500"}`}>
                  {workerStreamStatus === "connected" ? "check_circle" : "warning"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-2xl font-bold text-slate-900">
                  {workerStreamStatus === "connected" ? "Operational" : "Degraded"}
                </p>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Telemetry: {workerStreamStatus}</p>
            </article>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-slate-100 bg-white p-2 shadow-sm sm:flex-row">
            <div className="relative w-full sm:w-80">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
              <input
                className="block h-11 w-full rounded-xl border border-slate-100 bg-slate-50 pl-10 pr-4 text-sm text-[#0d181b] outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-50"
                placeholder="Search users by email..."
                type="text"
                value={userFilter}
                onChange={(event) => setUserFilter(event.target.value)}
              />
            </div>

            <div className="flex w-full gap-2 sm:w-auto">
              <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 sm:flex-none">
                <span className="material-symbols-outlined text-xl">filter_list</span>
                Filter
              </button>
              <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 sm:flex-none">
                <span className="material-symbols-outlined text-xl">sort</span>
                Sort
              </button>
            </div>
          </div>

          <div className="w-full overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">User</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">Role</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">Storage Used</th>
                    <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-widest text-slate-400">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-sm font-medium text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined text-4xl opacity-20">person_off</span>
                          No users found.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((item) => {
                      const isSelf = item.user.id === sessionUser.id;
                      const storageGb = estimateStorageGb(item.uploadCount);
                      const storageQuotaGb = 1000;
                      const storageRatio = clampPercent((storageGb / storageQuotaGb) * 100);

                      return (
                        <tr key={item.user.id} className="group transition-colors hover:bg-slate-50/50">
                          <td className="whitespace-nowrap px-6 py-5">
                            <div className="flex items-center">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-bold text-slate-500 transition-transform group-hover:scale-110">
                                {initialsFromEmail(item.user.email)}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-bold text-slate-900">{item.user.email.split("@")[0]}</div>
                                <div className="text-xs font-medium text-slate-400">{item.user.email}</div>
                              </div>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-5 text-sm">
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all shadow-sm ${item.user.isAdmin
                                ? "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200"
                                : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
                                }`}
                              onClick={() => onToggleAdmin(item.user.id, !item.user.isAdmin, isSelf)}
                            >
                              <span className="material-symbols-outlined text-base">
                                {item.user.isAdmin ? "verified_user" : "person"}
                              </span>
                              {item.user.isAdmin ? "Admin" : "User"}
                            </button>
                          </td>

                          <td className="whitespace-nowrap px-6 py-5">
                            <div className="flex w-full max-w-[200px] flex-col gap-2">
                              <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                                <span className="text-slate-900">{storageGb} GB</span>
                                <span className="text-slate-400">{storageRatio}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-1.5 rounded-full transition-all duration-500 ${storageRatio > 85 ? "bg-red-500" : "bg-cyan-500"
                                    }`}
                                  style={{ width: `${storageRatio}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-5 text-center">
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
                              <span className="h-5 w-10 rounded-full bg-slate-200 transition peer-checked:bg-cyan-500" />
                              <span className="absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
                            </label>
                          </td>

                          <td className="whitespace-nowrap px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                              <input
                                className="h-9 w-40 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-50"
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
                              <button
                                type="button"
                                className="flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800"
                                onClick={() => onResetPassword(item.user.id)}
                              >
                                <span className="material-symbols-outlined text-base">lock_reset</span>
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
