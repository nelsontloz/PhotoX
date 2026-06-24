import { FaUsers } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function SharedPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaUsers}
          title="Shared"
          description="Photos you've shared with others."
          accent="primary"
        />
      </AppShell>
    </RequireAuth>
  )
}
