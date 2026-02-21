import { clampPercent, estimateStorageGb, initialsFromEmail } from "../utils";

function UserRow({
  item,
  sessionUserId,
  onToggleAdmin,
  onToggleActive,
  onResetPassword,
  resetPassword,
  onResetPasswordChange
}) {
  const isSelf = item.user.id === sessionUserId;
  const storageGb = estimateStorageGb(item.uploadCount);
  const storageQuotaGb = 1000;
  const storageRatio = clampPercent((storageGb / storageQuotaGb) * 100);

  return (
    <tr className="group hover:bg-slate-50 dark:hover:bg-background-dark/30 transition-colors">
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
          type="button"
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
              value={resetPassword || ""}
              onChange={(e) => onResetPasswordChange(item.user.id, e.target.value)}
            />
            <button
              type="button"
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
}

export function UsersTable({
  userFilter,
  onUserFilterChange,
  filteredUsers,
  users,
  sessionUserId,
  resetPasswordByUserId,
  onResetPasswordChange,
  onToggleAdmin,
  onToggleActive,
  onResetPassword
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Recent Users</h3>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-sm">search</span>
          <input
            className="pl-9 pr-4 h-9 w-64 bg-white dark:bg-background-dark border border-slate-200 dark:border-border-dark rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            placeholder="Search users..."
            type="text"
            value={userFilter}
            onChange={onUserFilterChange}
          />
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
                filteredUsers.map((item) => (
                  <UserRow
                    key={item.user.id}
                    item={item}
                    sessionUserId={sessionUserId}
                    onToggleAdmin={onToggleAdmin}
                    onToggleActive={onToggleActive}
                    onResetPassword={onResetPassword}
                    resetPassword={resetPasswordByUserId[item.user.id]}
                    onResetPasswordChange={onResetPasswordChange}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-border-dark bg-slate-50 dark:bg-background-dark">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Showing <span className="text-slate-900 dark:text-white">1</span> to <span className="text-slate-900 dark:text-white">{filteredUsers.length}</span> of <span className="text-slate-900 dark:text-white">{users.length}</span> results
          </span>
          <div className="flex gap-2">
            <button type="button" className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white dark:bg-card-dark border border-slate-200 dark:border-border-dark hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
              Prev
            </button>
            <button type="button" className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white dark:bg-card-dark border border-slate-200 dark:border-border-dark hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
