"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
      setIsCreateFormVisible(false);
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

  const totalPhotos = useMemo(
    () => users.reduce((sum, item) => sum + (item.uploadCount || 0), 0),
    [users]
  );

  const activeUsersCount = useMemo(
    () => users.filter((item) => item.user.isActive).length,
    [users]
  );

  const storagePercent = clampPercent((totalStorageGb / 2000) * 100); // snippet uses 2TB max

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
      setErrorMessage("You cannot remove your own admin role");
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
      setErrorMessage("You cannot disable your own account");
      return;
    }

    if (!nextValue && isTargetAdmin && isTargetActive && activeAdminCount <= 1) {
      setErrorMessage("At least one active admin is required");
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
      setErrorMessage("Password must be at least 8 characters");
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
      <div className="flex h-screen items-center justify-center bg-background-light dark:bg-background-dark text-slate-500">
        <p>Loading admin workspace...</p>
      </div>
    );
  }

  if (!sessionUser?.isAdmin) {
    return null;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Admin" isAdmin />

      <main className="flex-1 overflow-y-auto relative scroll-smooth flex flex-col items-center py-10 px-4 md:px-10">
        <div className="w-full max-w-[1200px] flex flex-col gap-8 pb-10">

          <div className="flex items-center gap-2 text-sm text-slate-500 w-full">
            <Link className="hover:text-primary transition-colors" href="/timeline">Home</Link>
            <span className="material-symbols-outlined text-base text-slate-400">chevron_right</span>
            <span className="text-slate-900 dark:text-white font-medium">Admin Console</span>
            <div className="ml-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-100 dark:bg-background-dark border border-slate-200 dark:border-border-dark whitespace-nowrap">
              <span className={`size-1.5 rounded-full ${workerStreamStatus === "connected" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 animate-pulse"}`}></span>
              {workerStreamStatus === "connected" ? "Worker Online" : "Telemetry Delayed"}
            </div>
          </div>

          <div className="flex flex-wrap justify-between items-end gap-4 pb-4 border-b border-slate-200 dark:border-border-dark">
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Admin Console</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm">System performance and user management overview.</p>
            </div>
            <button
              onClick={() => setIsCreateFormVisible(!isCreateFormVisible)}
              className="flex items-center gap-2 cursor-pointer justify-center overflow-hidden rounded-lg h-10 px-4 bg-primary hover:bg-primary/90 transition-colors text-white text-sm font-bold shadow-lg shadow-primary/20"
            >
              <span className="material-symbols-outlined text-lg">{isCreateFormVisible ? "close" : "add"}</span>
              <span>{isCreateFormVisible ? "Close" : "Add User"}</span>
            </button>
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 p-4 text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </div>
          )}

          {isCreateFormVisible && (
            <form
              className="grid gap-4 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-6 shadow-panel md:grid-cols-[1.5fr_1.5fr_auto_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block px-1">Email</label>
                <input
                  className="w-full h-11 rounded-lg border-transparent bg-slate-100 dark:bg-background-dark px-3 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-0 transition-all"
                  type="email"
                  placeholder="user@example.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block px-1">Password</label>
                <input
                  className="w-full h-11 rounded-lg border-transparent bg-slate-100 dark:bg-background-dark px-3 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-0 transition-all"
                  type="password"
                  placeholder="Password (min 8 chars)"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="flex items-center pt-5">
                <label className="inline-flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={newUserAdmin}
                    onChange={(e) => setNewUserAdmin(e.target.checked)}
                    className="size-4 rounded border-slate-300 text-primary focus:ring-primary dark:bg-background-dark dark:border-border-dark"
                  />
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Admin Access</span>
                </label>
              </div>
              <div className="pt-5">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="w-full h-11 rounded-lg bg-primary px-6 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-blue-600 disabled:opacity-50 transition-all uppercase tracking-wide"
                >
                  {createMutation.isPending ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 md:gap-6">
            <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-widest">Total Users</span>
                <span className="material-symbols-outlined text-lg">group</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-slate-900 dark:text-white">{users.length.toLocaleString()}</span>
                <span className="rounded bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{activeUsersCount} Active</span>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-widest">Active Admins</span>
                <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-slate-900 dark:text-white">{activeAdminCount}</span>
                <span className="rounded bg-cyan-50 dark:bg-primary/10 px-2 py-1 text-[10px] font-bold text-cyan-600 dark:text-primary">Privileged</span>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-widest">Storage Used</span>
                <span className="material-symbols-outlined text-lg">database</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-black text-slate-900 dark:text-white">{(totalStorageGb / 1000).toFixed(2)}<span className="text-xs font-bold ml-1 text-slate-400">TB / 4TB</span></span>
                <span className="text-[10px] font-bold text-primary">{storagePercent}%</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div className="bg-primary h-full transition-all duration-1000" style={{ width: `${storagePercent}%` }}></div>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-widest">Worker Backlog</span>
                <span className="material-symbols-outlined text-lg">speed</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-slate-900 dark:text-white">{workerBacklog}</span>
                <span className="rounded bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-500">{workerInFlight} Active</span>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-widest">System Health</span>
                <span className={`material-symbols-outlined text-lg ${workerStreamStatus === "connected" ? "text-emerald-500" : "text-amber-500"}`}>
                  {workerStreamStatus === "connected" ? "check_circle" : "warning"}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-xl font-black text-slate-900 dark:text-white">
                  {workerStreamStatus === "connected" ? "Operational" : "Degraded"}
                </span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Telemetry: {workerStreamStatus}</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Recent Users</h3>
              <div className="flex gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-sm">search</span>
                  <input
                    className="pl-9 pr-4 h-9 w-64 bg-white dark:bg-background-dark border border-slate-200 dark:border-border-dark rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    placeholder="Search users..."
                    type="text"
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-background-dark border-b border-slate-200 dark:border-border-dark">
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[25%]">User</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[12%]">Role</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[12%] text-right">Uploads</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[25%]">Space Used</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[10%] text-center">Status</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[16%] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-border-dark">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-sm text-slate-400">No users found.</td>
                      </tr>
                    ) : (
                      filteredUsers.map((item) => {
                        const isSelf = item.user.id === sessionUser.id;
                        const storageGb = estimateStorageGb(item.uploadCount);
                        const storageQuotaGb = 1000;
                        const storageRatio = clampPercent((storageGb / storageQuotaGb) * 100);

                        return (
                          <tr key={item.user.id} className="group hover:bg-slate-50 dark:hover:bg-background-dark/30 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="size-9 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs uppercase">
                                  {initialsFromEmail(item.user.email)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-slate-900 dark:text-white uppercase truncate max-w-[150px]">
                                    {item.user.email.split("@")[0]}
                                  </span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.user.email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <button
                                onClick={() => onToggleAdmin(item.user.id, !item.user.isAdmin, isSelf)}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors ${item.user.isAdmin
                                  ? "bg-primary/10 text-primary border border-primary/20"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-border-dark"
                                  }`}
                              >
                                {item.user.isAdmin ? "Admin" : "User"}
                              </button>
                            </td>
                            <td className="p-4 text-right">
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-300">{(item.uploadCount || 0).toLocaleString()}</span>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col gap-1.5 max-w-[140px]">
                                <div className="flex justify-between text-[10px] font-medium">
                                  <span className="text-slate-900 dark:text-slate-300">{storageGb}GB / 1TB</span>
                                  <span className="text-slate-500">{storageRatio}%</span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-500 ${storageRatio > 85 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${storageRatio}%` }}></div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-center">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={item.user.isActive}
                                  onChange={(e) => onToggleActive(item.user.id, e.target.checked, isSelf, item.user.isAdmin, item.user.isActive)}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                              </label>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <div className="relative group/edit">
                                  <input
                                    type="password"
                                    placeholder="Reset Pass"
                                    className="hidden group-hover/edit:block absolute right-10 top-1/2 -translate-y-1/2 w-32 h-8 px-2 py-1 text-[10px] bg-white dark:bg-background-dark border border-slate-200 dark:border-border-dark rounded shadow-lg focus:outline-none focus:ring-1 focus:ring-primary"
                                    value={resetPasswordByUserId[item.user.id] || ""}
                                    onChange={(e) => setResetPasswordByUserId(prev => ({ ...prev, [item.user.id]: e.target.value }))}
                                  />
                                  <button
                                    onClick={() => onResetPassword(item.user.id)}
                                    className="size-8 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary transition-colors"
                                    title="Reset Password"
                                  >
                                    <span className="material-symbols-outlined text-lg">lock_reset</span>
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-border-dark bg-slate-50 dark:bg-background-dark">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Showing <span className="text-slate-900 dark:text-white">1</span> to <span className="text-slate-900 dark:text-white">{filteredUsers.length}</span> of <span className="text-slate-900 dark:text-white">{users.length}</span> results
                </span>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white dark:bg-card-dark border border-slate-200 dark:border-border-dark hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    Prev
                  </button>
                  <button className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white dark:bg-card-dark border border-slate-200 dark:border-border-dark hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
