import { Inter } from "next/font/google";

import "material-symbols/outlined.css";
import "./globals.css";
import TopBar from "./components/top-bar";
import Providers from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

export const metadata = {
  title: "PhotoX",
  description: "Personal photo platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-sans antialiased`}>
        <Providers>
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
