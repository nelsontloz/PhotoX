import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — gateway (web consumer)', () => {
  it('validates expectations of Web', async () => {
    await new Verifier({
      provider: 'gateway',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'web-gateway.json')],
      logLevel: 'error',
    }).verifyProvider()
  }, 60_000)
})
