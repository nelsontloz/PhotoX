import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from './setup'

const provider = createPact('user-service')

describe('Gateway → user-service auth pact', () => {
  it('POST /v1/auth/register — happy path', async () => {
    await provider
      .given('a user can be registered')
      .uponReceiving('a register request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/register',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          accessToken: MatchersV3.string('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.token'),
          refreshToken: MatchersV3.string('some-refresh-token'),
          user: {
            id: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
            email: 'new@test.com',
            displayName: 'New User',
            createdAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
            updatedAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
          },
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/auth/register`,
          { email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        const data = res.data as { accessToken: string; user: { email: string } }
        expect(res.status).toBe(201)
        expect(data.accessToken).toBeTruthy()
        expect(data.user.email).toBe('new@test.com')
      })
  })

  it('POST /v1/auth/login — happy path', async () => {
    await provider
      .given('user exists with email user@test.com')
      .uponReceiving('a login request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'user@test.com', password: 'ValidPass123' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          accessToken: MatchersV3.string('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.token'),
          refreshToken: MatchersV3.string('some-refresh-token'),
          user: {
            id: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
            email: 'user@test.com',
            displayName: 'Test User',
            createdAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
            updatedAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
          },
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/auth/login`,
          { email: 'user@test.com', password: 'ValidPass123' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        const data = res.data as { accessToken: string; user: { email: string } }
        expect(res.status).toBe(200)
        expect(data.accessToken).toBeTruthy()
        expect(data.user.email).toBe('user@test.com')
      })
  })

  it('POST /v1/auth/refresh — happy path', async () => {
    await provider
      .given('a valid refresh token exists')
      .uponReceiving('a refresh request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/refresh',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: 'valid-refresh-token-value' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          accessToken: MatchersV3.string('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.token'),
          refreshToken: MatchersV3.string('rotated-refresh-token'),
          user: {
            id: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
            email: 'user@test.com',
            displayName: 'Test User',
            createdAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
            updatedAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
          },
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/auth/refresh`,
          { refreshToken: 'valid-refresh-token-value' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        const data = res.data as { accessToken: string; user: { email: string } }
        expect(res.status).toBe(200)
        expect(data.accessToken).toBeTruthy()
        expect(data.user.email).toBe('user@test.com')
      })
  })

  it('POST /v1/auth/logout — happy path', async () => {
    await provider
      .given('a valid refresh token exists')
      .uponReceiving('a logout request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/logout',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: 'valid-refresh-token-value' },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/auth/logout`,
          { refreshToken: 'valid-refresh-token-value' },
          { headers: { 'Content-Type': 'application/json' }, validateStatus: () => true },
        )
        expect(res.status).toBe(204)
      })
  })
})
