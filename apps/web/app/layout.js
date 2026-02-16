import { Manrope } from "next/font/google";
import Link from "next/link";

import "./globals.css";
import Providers from "./providers";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope"
});

export const metadata = {
  title: "PhotoX",
  description: "Personal photo platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} min-h-screen font-[family-name:var(--font-manrope)]`}>
        <Providers>
          <header className="sticky top-0 z-40 border-b border-[#d5e2e8] bg-white/85 backdrop-blur-sm">
            <div className="shell flex items-center justify-between py-3">
              <Link href="/" className="text-lg font-extrabold tracking-tight text-ocean-900">
                PhotoX
              </Link>
              <nav className="flex items-center gap-4 text-sm font-semibold text-ocean-700">
                <Link href="/register" className="hover:text-ocean-900">
                  Register
                </Link>
                <Link href="/login" className="hover:text-ocean-900">
                  Login
                </Link>
                <Link href="/upload" className="hover:text-ocean-900">
                  Upload
                </Link>
                <Link href="/timeline" className="hover:text-ocean-900">
                  Timeline
                </Link>
              </nav>
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
