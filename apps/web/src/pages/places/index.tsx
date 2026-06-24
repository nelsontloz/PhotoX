import { FaMapLocationDot } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function PlacesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaMapLocationDot}
          title="Places"
          description="Browse your photos by where they were taken."
          accent="primary"
        />
      </AppShell>
    </RequireAuth>
  )
}
