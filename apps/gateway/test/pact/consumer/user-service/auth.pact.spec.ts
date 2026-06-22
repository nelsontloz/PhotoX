/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupUserServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const provider = createPact('user-service')
let app: INestApplication
let stub: StubProxy

beforeAll(async () => {
  const setup = await setupUserServicePactModule()
  app = setup.app
  stub = setup.stub
}, 30_000)

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  stub.targetUrl = ''
  stub.calls.length = 0
})

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
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' })
        expect(res.status).toBe(201)
        expect(res.body.accessToken).toBeTruthy()
        expect(res.body.user.email).toBe('new@test.com')
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
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'user@test.com', password: 'ValidPass123' })
        expect(res.status).toBe(200)
        expect(res.body.accessToken).toBeTruthy()
        expect(res.body.user.email).toBe('user@test.com')
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
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: 'valid-refresh-token-value' })
        expect(res.status).toBe(200)
        expect(res.body.accessToken).toBeTruthy()
        expect(res.body.user.email).toBe('user@test.com')
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
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/logout')
          .send({ refreshToken: 'valid-refresh-token-value' })
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/auth/register — email already exists (409)', async () => {
    await provider
      .given('email new@test.com is already registered')
      .uponReceiving('a register request for an existing email')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/register',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' },
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('Email already registered'),
        }),
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' })
      })
  })

  it('POST /v1/auth/login — invalid credentials (401)', async () => {
    await provider
      .given('login credentials are invalid')
      .uponReceiving('a login request with wrong credentials')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'unknown@test.com', password: 'WrongPass123' },
      })
      .willRespondWith({
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('Invalid credentials'),
        }),
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'unknown@test.com', password: 'WrongPass123' })
      })
  })

  it('POST /v1/auth/refresh — invalid token (401)', async () => {
    await provider
      .given('refresh token is invalid or revoked')
      .uponReceiving('a refresh request with an invalid token')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/refresh',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: 'invalid-refresh-token-value' },
      })
      .willRespondWith({
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('Invalid refresh token'),
        }),
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: 'invalid-refresh-token-value' })
      })
  })
})
