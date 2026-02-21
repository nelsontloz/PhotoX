"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  createAdminManagedUser,
  disableAdminManagedUser,
  formatApiError,
  listAdminUsers,
  resetAdminManagedUserPassword,
  updateAdminManagedUser
} from "../../lib/api";
import { countActiveAdmins } from "../../lib/admin-metrics";
import AppSidebar from "../components/app-sidebar";
import { useRequireSession } from "../shared/hooks/useRequireSession";
import { useWorkerTelemetry } from "./hooks/useWorkerTelemetry";
import { AdminHeader } from "./components/AdminHeader";
import { CreateUserForm } from "./components/CreateUserForm";
import { AdminKpiCards } from "./components/AdminKpiCards";
import { UsersTable } from "./components/UsersTable";
import { clampPercent, estimateStorageGb } from "./utils";

export default function AdminPage() {
  const { meQuery, user: sessionUser, isAuthorized } = useRequireSession({
    redirectPath: "/admin",
    requireAdmin: true,
    nonAdminRedirect: "/timeline"
  });

  const [errorMessage, setErrorMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserAdmin, setNewUserAdmin] = useState(false);
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState({});
  const [userFilter, setUserFilter] = useState("");
  const [isCreateFormVisible, setIsCreateFormVisible] = useState(false);

  const { workerTelemetry, workerStreamStatus } = useWorkerTelemetry(Boolean(sessionUser?.isAdmin));

  const refreshUsers = useCallback(async () => {
    const payload = await listAdminUsers({ limit: 100, offset: 0 });
    setUsers(payload.items || []);
  }, []);

  useEffect(() => {
    if (!isAuthorized) {
      return;
    }

    refreshUsers().catch((error) => setErrorMessage(formatApiError(error)));
  }, [isAuthorized, refreshUsers]);

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

  const activeAdminCount = useMemo(() => countActiveAdmins(users), [users]);

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

  const storagePercent = clampPercent((totalStorageGb / 2000) * 100);

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

  if (meQuery.isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background-light dark:bg-background-dark text-slate-500">
        <p>Loading admin workspace...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Admin" isAdmin />

      <main className="flex-1 overflow-y-auto relative scroll-smooth flex flex-col items-center py-10 px-4 md:px-10">
        <div className="w-full max-w-[1200px] flex flex-col gap-8 pb-10">
          <AdminHeader
            workerStreamStatus={workerStreamStatus}
            isCreateFormVisible={isCreateFormVisible}
            onToggleCreateForm={() => setIsCreateFormVisible((current) => !current)}
          />

          {errorMessage && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 p-4 text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </div>
          )}

          {isCreateFormVisible && (
            <CreateUserForm
              newUserEmail={newUserEmail}
              newUserPassword={newUserPassword}
              newUserAdmin={newUserAdmin}
              onEmailChange={(e) => setNewUserEmail(e.target.value)}
              onPasswordChange={(e) => setNewUserPassword(e.target.value)}
              onAdminChange={(e) => setNewUserAdmin(e.target.checked)}
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              isPending={createMutation.isPending}
            />
          )}

          <AdminKpiCards
            usersCount={users.length}
            activeUsersCount={activeUsersCount}
            activeAdminCount={activeAdminCount}
            totalStorageTb={totalStorageGb / 1000}
            storagePercent={storagePercent}
            workerBacklog={workerBacklog}
            workerInFlight={workerInFlight}
            workerStreamStatus={workerStreamStatus}
          />

          <UsersTable
            userFilter={userFilter}
            onUserFilterChange={(e) => setUserFilter(e.target.value)}
            filteredUsers={filteredUsers}
            users={users}
            sessionUserId={sessionUser?.id}
            resetPasswordByUserId={resetPasswordByUserId}
            onResetPasswordChange={(userId, value) => setResetPasswordByUserId((prev) => ({ ...prev, [userId]: value }))}
            onToggleAdmin={onToggleAdmin}
            onToggleActive={onToggleActive}
            onResetPassword={onResetPassword}
          />
        </div>
      </main>
    </div>
  );
}
