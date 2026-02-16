import { Manrope } from "next/font/google";

import "./globals.css";
import TopBar from "./components/top-bar";
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
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
