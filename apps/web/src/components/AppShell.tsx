import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader'
import { Sidebar } from './Sidebar'
import { UploadNotification } from './UploadNotification'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-6 pt-6">
          {children}
        </main>
      </div>
      <UploadNotification />
    </div>
  )
}
