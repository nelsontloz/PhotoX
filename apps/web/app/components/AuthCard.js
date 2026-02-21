import Link from "next/link";

/**
 * Branded header used at the top of auth pages (Login, Register).
 *
 * Props:
 *  - subtitle: string
 */
export function AuthBrandHeader({ subtitle }) {
    return (
        <div className="flex flex-col items-center mb-10 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20 text-primary mb-4">
                <span className="material-symbols-outlined text-3xl">photo_library</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white mb-2">PhotoX</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-normal">{subtitle}</p>
        </div>
    );
}

/**
 * Auth form card: white/dark card wrapping children, with a footer link row.
 *
 * Props:
 *  - children: ReactNode — form body
 *  - footerText: string — e.g. "Don't have an account?"
 *  - footerLinkLabel: string — e.g. "Create an account"
 *  - footerLinkIcon: string — material symbol name, e.g. "arrow_forward"
 *  - footerLinkHref: string
 */
export function AuthCard({ children, footerText, footerLinkLabel, footerLinkIcon, footerLinkHref }) {
    return (
        <div className="w-full max-w-md p-6">
            <div className="w-full rounded-xl bg-white dark:bg-[#1c2430] border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden">
                {children}
                <div className="px-8 py-5 bg-slate-50 dark:bg-[#151b23] border-t border-slate-200 dark:border-slate-800 text-center">
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                        {footerText}{" "}
                        <Link
                            className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors"
                            href={footerLinkHref}
                        >
                            {footerLinkLabel}
                            {footerLinkIcon && (
                                <span className="material-symbols-outlined text-[16px] font-bold">{footerLinkIcon}</span>
                            )}
                        </Link>
                    </p>
                </div>
            </div>
            <div className="mt-8 text-center">
                <p className="text-xs text-slate-400 dark:text-slate-600 font-medium">PhotoX v2.4.0</p>
            </div>
        </div>
    );
}
