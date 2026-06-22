import { api } from './client'
import type { AuthResponse, LoginRequest, RegisterRequest } from '@photox/shared-types'

export async function login(req: LoginRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/v1/auth/login', req)
  return data
}

export async function register(req: RegisterRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/v1/auth/register', req)
  return data
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/v1/auth/refresh', { refreshToken })
  return data
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/v1/auth/logout', { refreshToken })
}
