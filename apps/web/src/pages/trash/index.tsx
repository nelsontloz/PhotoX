import { FaTrash } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { PlaceholderPage } from '../../components/PlaceholderPage'

export default function TrashPage() {
  return (
    <RequireAuth>
      <AppShell>
        <PlaceholderPage
          icon={FaTrash}
          title="Trash"
          description="Recently deleted photos."
          accent="red"
        />
      </AppShell>
    </RequireAuth>
  )
}
