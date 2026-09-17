import { HealthService } from './health.service'

describe('HealthService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports ok when core is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const result = await new HealthService().check()
    expect(result.status).toBe('ok')
    expect(result.service).toBe('gateway')
    expect(result.checks.core?.status).toBe('up')
  })

  it('reports degraded when core is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')))
    const result = await new HealthService().check()
    expect(result.status).toBe('degraded')
    expect(result.checks.core?.status).toBe('down')
  })
})
