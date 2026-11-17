import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type {
  UploadCompleteResponse,
  UploadSessionCreated,
  UploadSessionStatusResponse,
} from '@photox/shared-types';
import {
  FIXTURES_DIR,
  Then,
  When,
  authHeaders,
  requireAuth,
  scenarioState,
  type Ctx,
} from '../support';

// Per-scenario upload-session state (support.ts Ctx untouched).
interface UploadSessionState {
  uploadId: string;
  chunkSizeBytes: number;
  totalParts: number;
  expectedSizeBytes: number;
  completedAssetId?: string;
}

function sessionState(ctx: Ctx): UploadSessionState {
  const state = scenarioState<Partial<UploadSessionState>>(ctx);
  if (!state.uploadId) throw new Error('create a chunked upload session first');
  return state as UploadSessionState;
}

When('I create a chunked upload session for {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx);
  const bytes = await readFile(join(FIXTURES_DIR, name));
  const response = await request.post('/api/v1/uploads', {
    headers: authHeaders(auth),
    data: { sizeBytes: bytes.length, originalName: name },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as UploadSessionCreated;
  expect(body.uploadId).toBeTruthy();
  // the server fixes the chunk grid — totalParts must cover the whole fixture
  expect(body.totalParts).toBe(Math.ceil(bytes.length / body.chunkSizeBytes));
  const state = scenarioState<Partial<UploadSessionState>>(ctx);
  state.uploadId = body.uploadId;
  state.chunkSizeBytes = body.chunkSizeBytes;
  state.totalParts = body.totalParts;
  state.expectedSizeBytes = bytes.length;
});

When('I upload every part of {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx);
  const state = sessionState(ctx);
  const bytes = await readFile(join(FIXTURES_DIR, name));
  // split by the returned chunk size, never a hardcoded one: today's fixture fits in a single part,
  // a bigger fixture would just loop
  for (let index = 0; index < state.totalParts; index++) {
    const start = index * state.chunkSizeBytes;
    const part = bytes.subarray(start, Math.min(start + state.chunkSizeBytes, bytes.length));
    const response = await request.put(`/api/v1/uploads/${state.uploadId}/parts/${index}`, {
      headers: { ...authHeaders(auth), 'Content-Type': 'application/octet-stream' },
      data: part,
    });
    expect(response.status()).toBe(204);
  }
});

Then('the upload session reports the received part indices', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const state = sessionState(ctx);
  const response = await request.get(`/api/v1/uploads/${state.uploadId}`, {
    headers: authHeaders(auth),
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as UploadSessionStatusResponse;
  // the resume primitive: the client diffs these against 0..totalParts-1 and re-PUTs the gaps
  expect(body.receivedParts).toEqual(Array.from({ length: state.totalParts }, (_, index) => index));
  expect(body.receivedBytes).toBe(state.expectedSizeBytes);
});

When('I complete the upload session', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const state = sessionState(ctx);
  const response = await request.post(`/api/v1/uploads/${state.uploadId}/complete`, {
    headers: authHeaders(auth),
  });
  // this request stored the bytes: 201 (200 means "already owned", which this first complete is not)
  expect(response.status()).toBe(201);
  const body = (await response.json()) as UploadCompleteResponse;
  expect(body.asset.id).toBeTruthy();
  state.completedAssetId = body.asset.id;
  // the reused timeline steps read ctx.assetId
  ctx.assetId = body.asset.id;
});

Then('the session status reports completed with its asset id', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const state = sessionState(ctx);
  const response = await request.get(`/api/v1/uploads/${state.uploadId}`, {
    headers: authHeaders(auth),
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as UploadSessionStatusResponse;
  expect(body.status).toBe('completed');
  expect(body.assetId).toBe(state.completedAssetId);
});
