import Link from "next/link";

export function getSidebarItems(isAdmin) {
  const items = [
    { href: "/timeline", label: "Timeline", icon: "photo_library" },
    { href: "/albums", label: "Albums", icon: "photo_album" },
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
    <>
      <aside
        className="shrink-0 z-50 w-[72px] bg-white dark:bg-background-dark border-r border-gray-200 dark:border-border-dark lg:w-60 transition-[width] duration-300 group flex flex-col"
      >
        <nav className="flex flex-col gap-2 p-3 mt-4">
          {navItems.map((item) => {
            const isActive = item.label === activeLabel;
            return (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className={`flex items-center gap-4 px-3 py-3 rounded-lg transition-all group/item relative overflow-hidden ${isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white"
                  }`}
              >
                <span className="material-symbols-outlined shrink-0">{item.icon}</span>
                <span className="whitespace-nowrap opacity-0 lg:opacity-100 transition-opacity duration-300">
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full"></div>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3 mb-4">
          <Link
            href="#"
            className="flex items-center gap-4 px-3 py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-red-500 dark:hover:text-red-400 transition-colors group/item"
          >
            <span className="material-symbols-outlined shrink-0">delete</span>
            <span className="whitespace-nowrap opacity-0 lg:opacity-100 transition-opacity duration-300">Trash</span>
          </Link>
          <Link
            href="#"
            className="flex items-center gap-4 px-3 py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white transition-colors group/item"
          >
            <span className="material-symbols-outlined shrink-0">settings</span>
            <span className="whitespace-nowrap opacity-0 lg:opacity-100 transition-opacity duration-300">Settings</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
