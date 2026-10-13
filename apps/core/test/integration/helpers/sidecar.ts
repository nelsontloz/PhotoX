import request from 'supertest'
import { apiServer, seedAsset, seedFile, seedUser } from '../helpers'
import type { ApiTestApp } from '../helpers'

export async function seedSidecarAsset(t: ApiTestApp) {
  const owner = await seedUser(t)
  const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
  const act = t.signToken({ id: owner.id, email: owner.email, role: owner.role }, { act: true })
  const file = await seedFile(t, owner.id)
  const asset = await seedAsset(t, owner.id, file.id)
  return { owner, token, act, file, asset }
}

export interface SidecarHarnessOpts {
  route: (assetId: string) => string
  body: Record<string, unknown>
  repo: { count(): Promise<number> }
  getRoute?: (assetId: string) => string
}

export async function sidecarHarness(t: ApiTestApp, opts: SidecarHarnessOpts): Promise<void> {
  const { asset } = await seedSidecarAsset(t)
  const res = await request(apiServer(t)).post(opts.route(asset.id)).send(opts.body)
  expect(res.status).toBe(401)
  expect(await opts.repo.count()).toBe(0)
  if (opts.getRoute) {
    const get = await request(apiServer(t)).get(opts.getRoute(asset.id))
    expect(get.status).toBe(401)
  }
}
