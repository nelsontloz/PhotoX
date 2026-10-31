import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useRoutes, type RouteObject } from 'react-router-dom';
import { LoadingState } from './components/StateViews';
import { RequireAuth } from './components/RequireAuth';

const HomePage = lazy(() => import('./pages/index'));
const AdminPage = lazy(() => import('./pages/admin'));
const AlbumsPage = lazy(() => import('./pages/albums'));
const AlbumDetailPage = lazy(() => import('./pages/albums/[id]'));
const FavoritesPage = lazy(() => import('./pages/favorites'));
const LoginPage = lazy(() => import('./pages/login'));
const PeoplePage = lazy(() => import('./pages/people'));
const PersonDetailPage = lazy(() => import('./pages/people/[id]'));
const PlacesPage = lazy(() => import('./pages/places'));
const RegisterPage = lazy(() => import('./pages/register'));
const SearchPage = lazy(() => import('./pages/search'));
const SharePage = lazy(() => import('./pages/share/[token]'));
const SharedPage = lazy(() => import('./pages/shared'));
const TrashPage = lazy(() => import('./pages/trash'));

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/share/:token', element: <SharePage /> },
  {
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/albums', element: <AlbumsPage /> },
      { path: '/albums/:id', element: <AlbumDetailPage /> },
      { path: '/favorites', element: <FavoritesPage /> },
      { path: '/people', element: <PeoplePage /> },
      { path: '/people/:id', element: <PersonDetailPage /> },
      { path: '/places', element: <PlacesPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/shared', element: <SharedPage /> },
      { path: '/trash', element: <TrashPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function App() {
  const element = useRoutes(routes);
  return (
    <Suspense fallback={<LoadingState className="flex items-center justify-center h-screen" />}>
      {element}
    </Suspense>
  );
}
