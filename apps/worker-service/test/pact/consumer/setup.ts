import path from 'node:path'
import { PactV3 } from '@pact-foundation/pact'

export const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')

export function createPact(providerName: string, consumerSuffix?: string): PactV3 {
  return new PactV3({
    dir: PACT_DIR,
    consumer: consumerSuffix ? `worker-service-${consumerSuffix}` : 'worker-service',
    provider: providerName,
    logLevel: 'error',
  })
}
