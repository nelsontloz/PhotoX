import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import type {
  UploadCompleteResponse,
  UploadSessionCreated,
  UploadSessionStatusResponse,
} from '@photox/shared-types'
import {
  FIXTURES_DIR,
  Then,
  When,
  authHeaders,
  expectSingleTimelineItem,
  registerUser,
  requireAuth,
  waitForTimelineReady,
  type Ctx,
} from '../support'

// Per-scenario upload-session state, keyed by the scenario ctx (support.ts Ctx untouched).
interface UploadSessionState {
  uploadId: string
  chunkSizeBytes: number
  totalParts: number
  expectedSizeBytes: number
  completedAssetId?: string
}

const states = new WeakMap<Ctx, UploadSessionState>()

function sessionState(ctx: Ctx): UploadSessionState {
  const state = states.get(ctx)
  if (!state) throw new Error('create a chunked upload session first')
  return state
}

When('I create a chunked upload session for {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx)
  const bytes = await readFile(join(FIXTURES_DIR, name))
  const response = await request.post('/api/v1/uploads', {
    headers: authHeaders(auth),
    data: { sizeBytes: bytes.length, originalName: name },
  })
  expect(response.status()).toBe(201)
  const body = (await response.json()) as UploadSessionCreated
  expect(body.uploadId).toBeTruthy()
  // the server fixes the chunk grid — totalParts must cover the whole fixture
  expect(body.totalParts).toBe(Math.ceil(bytes.length / body.chunkSizeBytes))
  states.set(ctx, {
    uploadId: body.uploadId,
    chunkSizeBytes: body.chunkSizeBytes,
    totalParts: body.totalParts,
    expectedSizeBytes: bytes.length,
  })
})

When('I upload every part of {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx)
  const state = sessionState(ctx)
  const bytes = await readFile(join(FIXTURES_DIR, name))
  // split by the returned chunk size, never a hardcoded one: today's fixture fits in a single part,
  // a bigger fixture would just loop
  for (let index = 0; index < state.totalParts; index++) {
    const start = index * state.chunkSizeBytes
    const part = bytes.subarray(start, Math.min(start + state.chunkSizeBytes, bytes.length))
    const response = await request.put(`/api/v1/uploads/${state.uploadId}/parts/${index}`, {
      headers: { ...authHeaders(auth), 'Content-Type': 'application/octet-stream' },
      data: part,
    })
    expect(response.status()).toBe(204)
  }
})

Then('the upload session reports the received part indices', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const state = sessionState(ctx)
  const response = await request.get(`/api/v1/uploads/${state.uploadId}`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as UploadSessionStatusResponse
  // the resume primitive: the client diffs these against 0..totalParts-1 and re-PUTs the gaps
  expect(body.receivedParts).toEqual(Array.from({ length: state.totalParts }, (_, index) => index))
  expect(body.receivedBytes).toBe(state.expectedSizeBytes)
})

When('I complete the upload session', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const state = sessionState(ctx)
  const response = await request.post(`/api/v1/uploads/${state.uploadId}/complete`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as UploadCompleteResponse
  expect(body.asset.id).toBeTruthy()
  state.completedAssetId = body.asset.id
  // the reused timeline steps read ctx.assetId
  ctx.assetId = body.asset.id
  // a session-completed asset is pending like any other upload: wait out the timeline gate
  await waitForTimelineReady(request, auth, body.asset.id)
})

Then('the session status reports completed with its asset id', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const state = sessionState(ctx)
  const response = await request.get(`/api/v1/uploads/${state.uploadId}`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as UploadSessionStatusResponse
  expect(body.status).toBe('completed')
  expect(body.assetId).toBe(state.completedAssetId)
})

Then(
  'completing the upload session again returns the same asset as a deduplicated replay',
  async ({ request, ctx }) => {
    const auth = requireAuth(ctx)
    const state = sessionState(ctx)
    const response = await request.post(`/api/v1/uploads/${state.uploadId}/complete`, {
      headers: authHeaders(auth),
    })
    expect(response.status()).toBe(200)
    const body = (await response.json()) as UploadCompleteResponse
    expect(body.deduplicated).toBe(true)
    expect(body.asset.id).toBe(state.completedAssetId)
  },
)

Then('the upload session is not visible to another user', async ({ request, ctx }) => {
  const state = sessionState(ctx)
  // owner scoping: another account's session id must read as missing, not as forbidden
  const otherAuth = await registerUser(request)
  const response = await request.get(`/api/v1/uploads/${state.uploadId}`, {
    headers: authHeaders(otherAuth),
  })
  expect(response.status()).toBe(404)
})

Then('the timeline still shows exactly one item', async ({ page }) => {
  // the asset was created through the API after the timeline first loaded: reload to fetch it —
  // a single tile then proves the idempotent replay minted no second asset
  await page.goto('/')
  await expectSingleTimelineItem(page)
})
