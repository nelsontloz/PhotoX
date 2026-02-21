export function CreateUserForm({
  newUserEmail,
  newUserPassword,
  newUserAdmin,
  onEmailChange,
  onPasswordChange,
  onAdminChange,
  onSubmit,
  isPending
}) {
  return (
    <form
      className="grid gap-4 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-6 shadow-panel md:grid-cols-[1.5fr_1.5fr_auto_auto]"
      onSubmit={onSubmit}
    >
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block px-1">Email</label>
        <input
          className="w-full h-11 rounded-lg border-transparent bg-slate-100 dark:bg-background-dark px-3 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-0 transition-all"
          type="email"
          placeholder="user@example.com"
          value={newUserEmail}
          onChange={onEmailChange}
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
          onChange={onPasswordChange}
          minLength={8}
          required
        />
      </div>
      <div className="flex items-center pt-5">
        <label className="inline-flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={newUserAdmin}
            onChange={onAdminChange}
            className="size-4 rounded border-slate-300 text-primary focus:ring-primary dark:bg-background-dark dark:border-border-dark"
          />
          <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Admin Access</span>
        </label>
      </div>
      <div className="pt-5">
        <button
          type="submit"
          disabled={isPending}
          className="w-full h-11 rounded-lg bg-primary px-6 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-blue-600 disabled:opacity-50 transition-all uppercase tracking-wide"
        >
          {isPending ? "Creating..." : "Create User"}
        </button>
      </div>
    </form>
  );
}
