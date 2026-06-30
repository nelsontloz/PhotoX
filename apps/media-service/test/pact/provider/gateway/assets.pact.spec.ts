import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import { buildStateHandlers } from './state-handlers'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — media-service', () => {
  it('validates expectations of Gateway', async () => {
    await new Verifier({
      provider: 'media-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'gateway-assets-media-service.json')],
      logLevel: 'error',
      stateHandlers: buildStateHandlers(repos),
    }).verifyProvider()
  }, 30_000)
})
