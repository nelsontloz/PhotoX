import { lazy, Suspense } from 'react'
import { useRoutes, type RouteObject } from 'react-router-dom'
import { LoadingState } from './components/StateViews'

const HomePage = lazy(() => import('./pages/index'))
const AdminPage = lazy(() => import('./pages/admin'))
const AlbumsPage = lazy(() => import('./pages/albums'))
const AlbumDetailPage = lazy(() => import('./pages/albums/[id]'))
const FavoritesPage = lazy(() => import('./pages/favorites'))
const LoginPage = lazy(() => import('./pages/login'))
const PeoplePage = lazy(() => import('./pages/people'))
const PersonDetailPage = lazy(() => import('./pages/people/[id]'))
const PlacesPage = lazy(() => import('./pages/places'))
const RegisterPage = lazy(() => import('./pages/register'))
const SearchPage = lazy(() => import('./pages/search'))
const SharePage = lazy(() => import('./pages/share/[token]'))
const SharedPage = lazy(() => import('./pages/shared'))
const TrashPage = lazy(() => import('./pages/trash'))

const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '/albums', element: <AlbumsPage /> },
  { path: '/albums/:id', element: <AlbumDetailPage /> },
  { path: '/favorites', element: <FavoritesPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/people', element: <PeoplePage /> },
  { path: '/people/:id', element: <PersonDetailPage /> },
  { path: '/places', element: <PlacesPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/search', element: <SearchPage /> },
  { path: '/share/:token', element: <SharePage /> },
  { path: '/shared', element: <SharedPage /> },
  { path: '/trash', element: <TrashPage /> },
]

export function App() {
  const element = useRoutes(routes)
  return (
    <Suspense fallback={<LoadingState className="flex items-center justify-center h-screen" />}>
      {element}
    </Suspense>
  )
}
