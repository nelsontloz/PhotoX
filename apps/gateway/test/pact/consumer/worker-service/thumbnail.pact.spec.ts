/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from '../setup'

const worker = createPact('worker-service')

const ASSET_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const JOB_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'

describe('Gateway → worker-service thumbnail pact', () => {
  it('POST /v1/jobs/thumbnail — enqueue thumbnail jobs (happy path)', async () => {
    await worker
      .given('no existing job for this asset')
      .uponReceiving('a request to enqueue thumbnail jobs')
      .withRequest({
        method: 'POST',
        path: '/v1/jobs/thumbnail',
        headers: { 'Content-Type': 'application/json' },
        body: {
          assetId: MatchersV3.uuid(ASSET_ID),
          fileId: MatchersV3.uuid(FILE_ID),
          userId: MatchersV3.uuid(USER_ID),
          size: MatchersV3.string('sm'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          jobId: MatchersV3.uuid(JOB_ID),
          status: 'queued',
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/jobs/thumbnail`,
          { assetId: ASSET_ID, fileId: FILE_ID, userId: USER_ID, size: 'sm' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(201)
        expect(res.data.status).toBe('queued')
      })
  })

  it('POST /v1/jobs/thumbnail — enqueue duplicate (idempotent)', async () => {
    await worker
      .given('job already queued for this asset and size')
      .uponReceiving('a request to enqueue a duplicate thumbnail job')
      .withRequest({
        method: 'POST',
        path: '/v1/jobs/thumbnail',
        headers: { 'Content-Type': 'application/json' },
        body: {
          assetId: MatchersV3.uuid(ASSET_ID),
          fileId: MatchersV3.uuid(FILE_ID),
          userId: MatchersV3.uuid(USER_ID),
          size: MatchersV3.string('sm'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          jobId: MatchersV3.uuid(JOB_ID),
          status: 'queued',
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/jobs/thumbnail`,
          { assetId: ASSET_ID, fileId: FILE_ID, userId: USER_ID, size: 'sm' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(201)
        expect(res.data.status).toBe('queued')
      })
  })
})
