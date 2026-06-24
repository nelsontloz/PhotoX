import { FaGear } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaGear}
          title="Settings"
          description="Account and app preferences."
          accent="primary"
        />
      </AppShell>
    </RequireAuth>
  )
}
