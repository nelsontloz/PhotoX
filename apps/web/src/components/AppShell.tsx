import { createContext, useContext, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { AppHeader } from './AppHeader'
import { Sidebar } from './Sidebar'
import { UploadOverlay } from './UploadNotification'

// The scroll container of AppShell's <main>: sticky day headers and timeline virtualization both
// key off it. Consumers get the ref (stable object) and read/listen themselves.
export const ScrollContainerContext = createContext<RefObject<HTMLDivElement> | null>(null)

export function useScrollContainer(): RefObject<HTMLDivElement> | null {
  return useContext(ScrollContainerContext)
}

export function AppShell({
  children,
  mainClassName = 'flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-6 pt-6',
}: {
  children: ReactNode
  /** Full class list for <main> when a page needs its own scroll container (e.g. the map). */
  mainClassName?: string
}) {
  const mainRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main ref={mainRef} className={mainClassName}>
          <ScrollContainerContext.Provider value={mainRef}>
            {children}
          </ScrollContainerContext.Provider>
        </main>
      </div>
      <UploadOverlay />
    </div>
  )
}
