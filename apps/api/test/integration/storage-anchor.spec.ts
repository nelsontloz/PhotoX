import { existsSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { closeTestApp, createApiTestApp, seedUser, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'

function findWorkspaceRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return start
    dir = parent
  }
}

describe('storage dir anchoring', () => {
  it('resolves relative STORAGE_DIR at workspace root', async () => {
    const workspaceRoot = findWorkspaceRoot(__dirname)
    const apiDir = join(workspaceRoot, 'apps', 'api')
    const name = `test-storage-anchor-${randomBytes(4).toString('hex')}`
    const prevCwd = process.cwd()
    const prevStorage = process.env.STORAGE_DIR
    process.chdir(apiDir)
    let t: ApiTestApp | null = null
    try {
      t = await createApiTestApp({ mockUser: null, storageDir: name })
      const user = await seedUser(t)
      const token = t.signToken({ id: user.id, email: user.email, role: user.role })
      const bytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer()
      const res = await request(apiServer(t))
        .post('/api/v1/files')
        .set(t.authHeader(token))
        .attach('file', bytes, 'anchor.png')
      expect(res.status).toBe(201)
      const asset = res.body as unknown as { fileId: string }
      const record = await t.fileRepo.findOne({ where: { id: asset.fileId } })
      expect(record).toBeTruthy()
      const underRoot = join(workspaceRoot, name, record?.storageKey ?? '')
      const underApi = join(apiDir, name, record?.storageKey ?? '')
      expect(existsSync(underRoot)).toBe(true)
      expect(existsSync(underApi)).toBe(false)
    } finally {
      process.chdir(prevCwd)
      if (t) await closeTestApp(t)
      rmSync(join(workspaceRoot, name), { recursive: true, force: true })
      if (prevStorage === undefined) delete process.env.STORAGE_DIR
      else process.env.STORAGE_DIR = prevStorage
    }
  }, 120_000)
})
