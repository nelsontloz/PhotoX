import AppSidebar from "./app-sidebar";

/**
 * Shared layout for all authenticated pages.
 *
 * Props:
 *  - activeLabel: string — the sidebar nav item to highlight
 *  - isAdmin: boolean
 *  - mainClassName: string — extra classes for <main>
 *  - children
 */
export function PageLayout({ activeLabel, isAdmin = false, mainClassName = "", children }) {
    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
            <AppSidebar activeLabel={activeLabel} isAdmin={isAdmin} />
            <main className={`flex-1 overflow-y-auto relative scroll-smooth ${mainClassName}`}>
                {children}
            </main>
        </div>
    );
}
