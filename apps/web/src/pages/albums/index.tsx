import { FaPhotoFilm } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function AlbumsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaPhotoFilm}
          title="Albums"
          description="Group your photos into collections."
          accent="primary"
        />
      </AppShell>
    </RequireAuth>
  )
}
