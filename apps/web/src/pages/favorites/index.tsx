import { FaHeart } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaHeart}
          title="Favorites"
          description="Photos you've marked as favorites."
          accent="amber"
        />
      </AppShell>
    </RequireAuth>
  )
}
