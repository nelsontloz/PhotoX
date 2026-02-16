"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { logoutUser } from "../../lib/api";
import { clearSession, readRefreshToken, readSession } from "../../lib/session";

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
    const refreshToken = readRefreshToken();
    if (refreshToken) {
      try {
        await logoutUser(refreshToken);
      } catch (_error) {
        // local logout still proceeds
      }
    }

    clearSession();
    router.replace("/login");
  }

  if (isHidden) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[#d5e2e8] bg-white/85 backdrop-blur-sm">
      <div className="shell flex items-center justify-between py-3">
        <Link href={user ? "/timeline" : "/login"} className="text-lg font-extrabold tracking-tight text-ocean-900">
          PhotoX
        </Link>

        {user ? (
          <div className="flex items-center gap-3 text-sm font-semibold text-ocean-700">
            <span className="hidden rounded-md border border-ocean-100 bg-ocean-50 px-3 py-1 text-ocean-900 md:inline">{user.email}</span>
            {user.isAdmin ? (
              <Link href="/admin" className="btn btn-secondary">
                Admin
              </Link>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        ) : (
          <div className="text-sm font-semibold text-ocean-700">Please sign in</div>
        )}
      </div>
    </header>
  );
}
