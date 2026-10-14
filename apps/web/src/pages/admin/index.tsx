import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  FaBrain,
  FaChartColumn,
  FaCircleCheck,
  FaDatabase,
  FaHardDrive,
  FaUserShield,
} from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { useAuthStore } from '../../store/auth-store'
import { AppShell, useScrollContainer } from '../../components/AppShell'
import { LibraryStatsSection } from './library-stats'
import { AdminSection, cx } from './ui'
import {
  DetectionsReprocessSection,
  EmbeddingsReprocessSection,
  FacialDetectionCard,
  OcrReprocessSection,
} from './ai'
import { AssetHealthSection, OrphanCleanupSection } from './assets'
import { UsersSection } from './users'
import { BackupSection } from './backups'

// --- tabs -------------------------------------------------------------------------------
// One route (/admin), five sections. The active section lives in ?tab= so a reload, a shared
// link and the back button all land on the same panel; an unknown value falls back to overview.

const TABS = [
  { id: 'overview', label: 'Overview', icon: FaChartColumn },
  { id: 'ai', label: 'AI Pipelines', icon: FaBrain },
  { id: 'assets', label: 'Assets & Maintenance', icon: FaHardDrive },
  { id: 'users', label: 'Users', icon: FaUserShield },
  { id: 'backups', label: 'Backups', icon: FaDatabase },
] as const

type TabId = (typeof TABS)[number]['id']

const DEFAULT_TAB: TabId = 'overview'
const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id)
const PANEL_ID = 'admin-tabpanel'

const isTabId = (value: string | null): value is TabId => value !== null && TAB_IDS.includes(value)

const tabButtonId = (id: TabId): string => `admin-tab-${id}`

function AdminTabBar({ active, onSelect }: { active: TabId; onSelect: (id: TabId) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // Automatic activation: arrows move focus *and* selection, matching the APG tabs pattern.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    event.preventDefault()
    const tab = TABS[next]
    if (!tab) return
    buttons.current[next]?.focus()
    onSelect(tab.id)
  }

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 bg-background-dark/95 backdrop-blur border-b border-border-dark">
      <div
        role="tablist"
        aria-label="Admin console sections"
        className="flex gap-1 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab, index) => {
          const selected = tab.id === active
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[index] = el
              }}
              type="button"
              role="tab"
              id={tabButtonId(tab.id)}
              aria-selected={selected}
              aria-controls={selected ? PANEL_ID : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                'inline-flex items-center gap-2 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background-dark',
                selected
                  ? 'bg-primary-container text-on-primary-container shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
              )}
            >
              <Icon className="text-[13px]" aria-hidden="true" focusable="false" />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TabPanelContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'ai':
      return (
        <AdminSection
          card={false}
          title="Machine Learning Models & Inference"
          subtitle="Vision embeddings, facial clustering, object detection, and OCR pipelines."
          icon={<FaBrain />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FacialDetectionCard />
            <EmbeddingsReprocessSection />
            <DetectionsReprocessSection />
            <OcrReprocessSection />
          </div>
        </AdminSection>
      )
    case 'assets':
      return (
        <AdminSection
          card={false}
          title="Asset Health & Maintenance"
          subtitle="Queue depths across the transcoder and thumbnail generator."
          icon={<FaCircleCheck />}
        >
          <div className="space-y-6">
            <AssetHealthSection />
            <OrphanCleanupSection />
          </div>
        </AdminSection>
      )
    case 'users':
      return <UsersSection />
    case 'backups':
      return <BackupSection />
    case 'overview':
    default:
      return <LibraryStatsSection />
  }
}

// --- page -------------------------------------------------------------------------------

export function AdminPageContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const active: TabId = isTabId(rawTab) ? rawTab : DEFAULT_TAB
  const scrollContainer = useScrollContainer()

  // A hand-edited or stale ?tab= is corrected in place so the URL round-trips; a missing param
  // stays missing (no ?tab=overview noise, and no extra history entry on first load).
  useEffect(() => {
    if (rawTab === null || isTabId(rawTab)) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', DEFAULT_TAB)
        return next
      },
      { replace: true },
    )
  }, [rawTab, setSearchParams])

  const selectTab = useCallback(
    (id: TabId) => {
      setSearchParams({ tab: id })
    },
    [setSearchParams],
  )

  // Switching tabs — click or back/forward — parks the freshly swapped panel at the top of the
  // scroll area; the sticky tab bar keeps the row in view. First paint is left where it is.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    scrollContainer?.current?.scrollTo({ top: 0 })
  }, [active, scrollContainer])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-headline-xl text-on-surface tracking-tight">Admin Console</h1>
        <p className="text-body-sm text-on-surface-variant mt-1">
          System telemetry, worker pipelines, face inference, and instance user management.
        </p>
      </header>

      <AdminTabBar active={active} onSelect={selectTab} />

      <div
        key={active}
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabButtonId(active)}
        className="min-w-0"
      >
        <TabPanelContent tab={active} />
      </div>
    </div>
  )
}

export default function AdminPage() {
  const user = useAuthStore((s) => s.user)
  return (
    <RequireAuth>
      {user?.role !== 'admin' ? (
        <Navigate to="/" replace />
      ) : (
        <AppShell>
          <AdminPageContent />
        </AppShell>
      )}
    </RequireAuth>
  )
}
