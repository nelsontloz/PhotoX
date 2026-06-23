import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuthStore, subscribeAuthFailure } from './auth-store'
import * as authApi from '../api/auth'

vi.mock('../api/auth')

const mockLogin = vi.mocked(authApi.login)
const mockRegister = vi.mocked(authApi.register)
const mockLogout = vi.mocked(authApi.logout)
const mockRefresh = vi.mocked(authApi.refresh)

const mockUser = {
  id: 'u1',
  email: 'a@b.com',
  displayName: 'A',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: 'idle',
      error: null,
    })
  })

  it('login success sets user and tokens', async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: 'at1',
      refreshToken: 'rt1',
      user: mockUser,
    })

    await useAuthStore.getState().login('a@b.com', 'password')

    const s = useAuthStore.getState()
    expect(s.status).toBe('authenticated')
    expect(s.user).toEqual(mockUser)
    expect(s.accessToken).toBe('at1')
    expect(s.refreshToken).toBe('rt1')

    const stored = JSON.parse(localStorage.getItem('photox.auth') ?? '{}') as {
      state: { accessToken?: string }
    }
    expect(stored.state.accessToken).toBe('at1')
  })

  it('login error sets error status and message', async () => {
    mockLogin.mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    })

    await useAuthStore.getState().login('a@b.com', 'wrong')

    const s = useAuthStore.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe('Invalid credentials')
    expect(s.accessToken).toBeNull()
  })

  it('login network error falls back to generic message', async () => {
    mockLogin.mockRejectedValueOnce(new Error('network'))

    await useAuthStore.getState().login('a@b.com', 'x')

    const s = useAuthStore.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe('Login failed')
  })

  it('logout clears state and calls API', async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: 'at1',
      refreshToken: 'rt1',
      user: mockUser,
    })

    await useAuthStore.getState().login('a@b.com', 'password')
    expect(useAuthStore.getState().status).toBe('authenticated')

    mockLogout.mockResolvedValueOnce(undefined)
    await useAuthStore.getState().logout()

    const s = useAuthStore.getState()
    expect(s.status).toBe('idle')
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(mockLogout).toHaveBeenCalledWith('rt1')
  })

  it('register success sets user and tokens', async () => {
    mockRegister.mockResolvedValueOnce({
      accessToken: 'at2',
      refreshToken: 'rt2',
      user: mockUser,
    })

    await useAuthStore.getState().register('a@b.com', 'password', 'A')

    const s = useAuthStore.getState()
    expect(s.status).toBe('authenticated')
    expect(s.user).toEqual(mockUser)
    expect(s.accessToken).toBe('at2')
  })

  it('clearError resets error to null', async () => {
    mockLogin.mockRejectedValueOnce({
      response: { data: { message: 'fail' } },
    })

    await useAuthStore.getState().login('a@b.com', 'x')
    expect(useAuthStore.getState().error).toBe('fail')

    useAuthStore.getState().clearError()
    expect(useAuthStore.getState().error).toBeNull()
  })

  describe('refresh', () => {
    let failureCb: ReturnType<typeof vi.fn>
    let unsub: () => void

    beforeEach(() => {
      failureCb = vi.fn()
      unsub = subscribeAuthFailure(failureCb)
    })

    afterEach(() => {
      unsub()
    })

    it('swaps both tokens on success', async () => {
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'old-at',
        refreshToken: 'old-rt',
        status: 'authenticated',
      })

      mockRefresh.mockResolvedValueOnce({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        user: mockUser,
      })

      await useAuthStore.getState().refresh()

      const s = useAuthStore.getState()
      expect(s.status).toBe('authenticated')
      expect(s.accessToken).toBe('new-at')
      expect(s.refreshToken).toBe('new-rt')
      expect(s.user).toEqual(mockUser)
    })

    it('calls logout and fires failure listener on error', async () => {
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'old-at',
        refreshToken: 'old-rt',
        status: 'authenticated',
      })

      mockRefresh.mockRejectedValueOnce(new Error('expired'))
      mockLogout.mockResolvedValueOnce(undefined)

      await useAuthStore.getState().refresh()

      expect(useAuthStore.getState().status).toBe('idle')
      expect(useAuthStore.getState().accessToken).toBeNull()
      expect(failureCb).toHaveBeenCalledOnce()
    })

    it('single-flight: two concurrent calls share one request', async () => {
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'old-at',
        refreshToken: 'old-rt',
        status: 'authenticated',
      })

      let resolveFirst!: (v: {
        accessToken: string
        refreshToken: string
        user: typeof mockUser
      }) => void
      const firstPromise = new Promise<{
        accessToken: string
        refreshToken: string
        user: typeof mockUser
      }>((resolve) => {
        resolveFirst = resolve
      })

      mockRefresh.mockReturnValueOnce(firstPromise)

      const p1 = useAuthStore.getState().refresh()
      const p2 = useAuthStore.getState().refresh()

      expect(mockRefresh).toHaveBeenCalledOnce()

      resolveFirst({
        accessToken: 'fresh-at',
        refreshToken: 'fresh-rt',
        user: mockUser,
      })

      await Promise.all([p1, p2])

      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(useAuthStore.getState().accessToken).toBe('fresh-at')
    })

    it('no-op when refreshToken is null', async () => {
      useAuthStore.setState({ refreshToken: null })

      await useAuthStore.getState().refresh()

      expect(mockRefresh).not.toHaveBeenCalled()
    })
  })
})
