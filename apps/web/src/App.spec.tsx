import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from './store/auth-store'

vi.mock('./pages/index', () => ({ default: () => <p>home-marker</p> }))
vi.mock('./pages/admin', () => ({ default: () => <p>admin-marker</p> }))
vi.mock('./pages/albums', () => ({ default: () => <p>albums-marker</p> }))
vi.mock('./pages/albums/[id]', () => ({ default: () => <p>album-detail-marker</p> }))
vi.mock('./pages/favorites', () => ({ default: () => <p>favorites-marker</p> }))
vi.mock('./pages/login', () => ({ default: () => <p>login-marker</p> }))
vi.mock('./pages/people', () => ({ default: () => <p>people-marker</p> }))
vi.mock('./pages/people/[id]', () => ({ default: () => <p>person-detail-marker</p> }))
vi.mock('./pages/places', () => ({ default: () => <p>places-marker</p> }))
vi.mock('./pages/register', () => ({ default: () => <p>register-marker</p> }))
vi.mock('./pages/search', () => ({ default: () => <p>search-marker</p> }))
vi.mock('./pages/share/[token]', () => ({ default: () => <p>share-marker</p> }))
vi.mock('./pages/shared', () => ({ default: () => <p>shared-marker</p> }))
vi.mock('./pages/trash', () => ({ default: () => <p>trash-marker</p> }))

import { App } from './App'

const idleAuth = {
  user: null,
  accessToken: null,
  refreshToken: null,
  status: 'idle',
  error: null,
} as const

const authedAuth = {
  ...idleAuth,
  status: 'authenticated',
  user: {
    id: 'u-1',
    email: 'ada@example.com',
    role: 'user',
    displayName: 'Ada Lovelace',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
} as const

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  useAuthStore.setState({ ...idleAuth })
})

describe('App gated routes', () => {
  it('redirects an unauthenticated visit to / to the login page', async () => {
    useAuthStore.setState({ ...idleAuth })
    renderApp('/')

    expect(await screen.findByText('login-marker')).toBeTruthy()
    expect(screen.queryByText('home-marker')).toBeNull()
  })

  it('renders the home page for an authenticated visit to /', async () => {
    useAuthStore.setState({ ...authedAuth })
    renderApp('/')

    expect(await screen.findByText('home-marker')).toBeTruthy()
    expect(screen.queryByText('login-marker')).toBeNull()
  })

  it('gates every authed route, including keyed detail routes', async () => {
    useAuthStore.setState({ ...idleAuth })
    for (const path of [
      '/',
      '/albums',
      '/favorites',
      '/people',
      '/places',
      '/search',
      '/shared',
      '/trash',
      '/people/p-1',
      '/albums/a-1',
      '/admin',
    ]) {
      cleanup()
      renderApp(path)
      expect(await screen.findByText('login-marker')).toBeTruthy()
    }
  })

  it('leaves the public share route outside the gate', async () => {
    useAuthStore.setState({ ...idleAuth })
    renderApp('/share/tok-1')

    expect(await screen.findByText('share-marker')).toBeTruthy()
    expect(screen.queryByText('login-marker')).toBeNull()
  })

  it('redirects unknown URLs home instead of rendering a blank page', async () => {
    useAuthStore.setState({ ...authedAuth })
    renderApp('/typo')

    expect(await screen.findByText('home-marker')).toBeTruthy()
  })

  it('sends an unauthenticated unknown URL to login via the home redirect', async () => {
    useAuthStore.setState({ ...idleAuth })
    renderApp('/typo')

    expect(await screen.findByText('login-marker')).toBeTruthy()
  })
})
