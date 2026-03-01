"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { logoutUser } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";

const HIDDEN_ON_PATHS = new Set(["/login", "/register"]);

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);

  useEffect(() => {
    function syncSession() {
      setSession(readSession());
    }

    syncSession();
    window.addEventListener("photox:session-changed", syncSession);
    window.addEventListener("storage", syncSession);

    return () => {
      window.removeEventListener("photox:session-changed", syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const isHidden = useMemo(() => HIDDEN_ON_PATHS.has(pathname || ""), [pathname]);
  const user = session?.user || null;

  async function handleLogout() {
    try {
      await logoutUser();
    } catch (_error) {
      // local logout still proceeds
    }

    clearSession();
    router.replace("/login");
  }

  if (isHidden) {
    return null;
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 dark:border-border-dark bg-white/80 dark:bg-background-dark/80 backdrop-blur-md px-6 py-3 z-50 sticky top-0 h-16 w-full shrink-0">
      <div className="flex items-center gap-6 w-1/4">
        <Link href={user ? "/timeline" : "/login"} className="flex items-center gap-3 text-slate-900 dark:text-white group">
          <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined text-[20px]">photo_library</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">PhotoX</h1>
        </Link>
      </div>

      {/* Search Bar */}
      <div className="flex-1 max-w-lg mx-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const q = formData.get("search");
            const params = new URLSearchParams(window.location.search);
            if (q) params.set("q", q);
            else params.delete("q");
            router.push(`${pathname}?${params.toString()}`);
          }}
          className="relative flex items-center w-full group"
        >
          <div className="absolute left-3 text-slate-400 group-focus-within:text-primary transition-colors">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </div>
          <input
            name="search"
            className="w-full bg-slate-100 dark:bg-card-dark border-transparent focus:border-primary/50 focus:ring-0 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-500 transition-all shadow-sm"
            placeholder="Search memories, places, or dates..."
            type="text"
            defaultValue={new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("q") || ""}
          />
          <div className="absolute right-2 flex gap-1">
            <button type="button" className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-400 transition-colors" title="Filter options">
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
          </div>
        </form>
      </div>

      {/* Right Actions */}
      <div className="flex items-center justify-end gap-4 w-1/4">
        {user ? (
          <>
            {pathname.startsWith("/albums") && (
              <button className="hidden sm:flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-lg shadow-primary/20">
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>New Album</span>
              </button>
            )}
            <div className="h-6 w-px bg-gray-200 dark:bg-border-dark mx-1 hidden sm:block"></div>
            <button className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-card-dark text-slate-500 dark:text-slate-400 transition-colors">
              <span className="material-symbols-outlined text-[22px]">notifications</span>
              <span className="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-white dark:border-background-dark"></span>
            </button>
            <button
              onClick={handleLogout}
              className="size-9 rounded-full bg-gradient-to-br from-primary to-purple-600 p-[2px] ring-2 ring-transparent hover:ring-primary/50 transition-all"
              title={`Logout (${user.email})`}
            >
              <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center overflow-hidden text-[10px] text-white font-bold">
                {user.email.substring(0, 2).toUpperCase()}
              </div>
            </button>
          </>
        ) : (
          <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
