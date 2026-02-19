import Link from "next/link";

export function getSidebarItems(isAdmin) {
  const items = [
    { href: "/timeline", label: "Timeline", icon: "photo_library" },
    { href: "/upload", label: "Upload", icon: "cloud_upload" }
  ];

  if (isAdmin) {
    items.push({ href: "/admin", label: "Admin", icon: "admin_panel_settings" });
  }

  return items;
}

export default function AppSidebar({ activeLabel = "Timeline", isAdmin = false }) {
  const navItems = getSidebarItems(isAdmin);

  return (
    <div className="flex h-full w-full flex-col justify-between bg-white p-6 lg:bg-white/80">
      <div>
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
            <span className="text-cyan-500">◎</span>
            PhotoX
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Manage your memories</p>
        </div>

        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive = item.label === activeLabel;
            return (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className={
                  isActive
                    ? "flex items-center gap-3 rounded-lg bg-cyan-100 px-4 py-3 text-sm font-semibold text-cyan-700"
                    : "group flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                }
              >
                <span className="material-symbols-outlined shrink-0 text-xl">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">Storage</span>
          <span className="text-xs font-bold text-slate-900">45% used</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200">
          <div className="h-2 rounded-full bg-cyan-500" style={{ width: "45%" }} />
        </div>
      </div>
    </div>
  );
}
