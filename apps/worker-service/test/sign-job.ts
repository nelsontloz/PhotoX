import { createHmac } from 'node:crypto'
import { jobScopeOf } from '../src/queue/job-schemas'

// the worker verifies every job payload against the same secrets core stamps with — unit specs
// that boot a processor directly must configure them too (verifyJobSig fails closed)
export const TEST_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
export const TEST_WORKER_SECRET = 'worker-test-secret-9f8e7d6c5b4a3210'

export function useTestAuthEnv(): void {
  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET
  process.env.WORKER_JWT_SECRET = TEST_WORKER_SECRET
}

// stamp a test job the way core's enqueue does — same scope derivation (jobScopeOf) and HMAC
// construction, so processor verification passes with the harness secret
export function signJob<T extends { userId: string; assetId?: string; fileId?: string }>(
  data: T,
): T & { sig: string } {
  const scope = jobScopeOf(data)
  if (!scope) throw new Error('signJob needs assetId, fileId, or userId')
  return {
    ...data,
    sig: createHmac('sha256', TEST_WORKER_SECRET).update(`${data.userId}:${scope}`).digest('hex'),
  }
}
