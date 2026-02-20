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

import { useSidebar } from "./sidebar-context";

export default function AppSidebar({ activeLabel = "Timeline", isAdmin = false }) {
  const { isOpen, close } = useSidebar();
  const navItems = getSidebarItems(isAdmin);

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={close}
        ></div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-background-dark border-r border-gray-200 dark:border-border-dark transition-transform duration-300 lg:static lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"
          } lg:flex lg:flex-col lg:w-[72px] lg:hover:w-60 transition-[width,transform] duration-300 group`}
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
                <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300">
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
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300">Trash</span>
          </Link>
          <Link
            href="#"
            className="flex items-center gap-4 px-3 py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white transition-colors group/item"
          >
            <span className="material-symbols-outlined shrink-0">settings</span>
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300">Settings</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
