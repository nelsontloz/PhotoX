/**
 * Opt-in provider (core) verification of the web consumer pact.
 * Intentionally excluded from `pnpm verify`/CI — run manually:
 *
 *   pnpm --filter @photox/web test -- test/pact   # writes pacts/web-core.json
 *   pnpm --filter @photox/core test:pact:provider
 *
 * Skips cleanly when pacts/web-core.json is missing.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import * as argon2 from 'argon2'
import { closeTestApp, createApiTestApp, seedFile, seedThumbnail } from '../integration/helpers'
import type { ApiTestApp } from '../integration/helpers'
import { TokenService } from '../../src/users/tokens/token.service'

const PACT_PATH = path.resolve(__dirname, '../../../../pacts/web-core.json')

// literal values baked into pacts/web-core.json by the web consumer tests
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
// The pact addresses the asset by this literal in request paths and bodies. It happens to
// equal the USER_ID literal in the consumer spec; changing it would 404 those interactions.
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const ALBUM_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const REFRESH_TOKEN = 'valid-refresh-token'

const pactExists = existsSync(PACT_PATH)
if (!pactExists) {
  console.warn(
    `[pact-provider] ${PACT_PATH} not found — run "pnpm --filter @photox/web test -- test/pact" first. Skipping.`,
  )
}

describe.skipIf(!pactExists)('core provider pact verification (opt-in)', () => {
  let t: ApiTestApp
  let refreshTokenHash = ''
  let accessToken = ''

  /**
   * The pact reuses one fixture set across interactions without declaring provider states:
   * earlier requests trash and permanently delete the asset and delete the album. Restore the
   * album fixture set before every album request so each interaction sees the state it assumes.
   */
  async function ensureAlbumFixtures(): Promise<void> {
    const asset = await t.assetRepo.findOne({ where: { id: ASSET_ID } })
    if (!asset) {
      await t.assetRepo.save(
        t.assetRepo.create({
          id: ASSET_ID,
          userId: USER_ID,
          kind: 'photo',
          fileId: FILE_ID,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          originalName: 'photo.jpg',
          width: 1920,
          height: 1080,
          metadataStatus: 'ready',
          transcodeStatus: 'ready',
          thumbnailStatus: 'ready',
          faceCount: null,
          uploadedAt: new Date('2024-01-01T00:00:00.000Z'),
        }),
      )
    } else if (asset.isTrashed) {
      await t.assetRepo.update(ASSET_ID, { isTrashed: false, trashedAt: null })
    }

    const album = await t.albumRepo.findOne({ where: { id: ALBUM_ID } })
    if (!album) {
      await t.albumRepo.save(
        t.albumRepo.create({
          id: ALBUM_ID,
          userId: USER_ID,
          name: 'Trip 2025',
          description: null,
        }),
      )
    }

    const join = await t.albumAssetRepo.findOne({
      where: { albumId: ALBUM_ID, assetId: ASSET_ID },
    })
    if (!join) {
      await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: ALBUM_ID, assetId: ASSET_ID }))
    }

    const thumb = await t.thumbRepo.findOne({ where: { assetId: ASSET_ID, size: 'md' } })
    if (!thumb) {
      await seedThumbnail(t, ASSET_ID)
    }
  }

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })

    await t.userRepo.save(
      t.userRepo.create({
        id: USER_ID,
        email: 'user@test.com',
        role: 'user',
        passwordHash: await argon2.hash('ValidPass123'),
        displayName: 'Test User',
      }),
    )

    const file = await seedFile(t, USER_ID, {
      bytes: Buffer.alloc(1024),
      mimeType: 'image/jpeg',
      originalName: 'photo.jpg',
    })
    await t.fileRepo.update(file.id, { id: FILE_ID })

    await ensureAlbumFixtures()

    const tokenService = t.app.get(TokenService)
    refreshTokenHash = tokenService.hash(REFRESH_TOKEN)
    await t.refreshRepo.save(
      t.refreshRepo.create({
        userId: USER_ID,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revokedAt: null,
      }),
    )

    accessToken = t.signToken({ id: USER_ID, email: 'user@test.com', role: 'user' })
    await t.app.listen(0, '127.0.0.1')
  }, 180_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  it('verifies every recorded web interaction', async () => {
    const verifier = new Verifier({
      provider: 'core',
      providerBaseUrl: await t.app.getUrl(),
      pactUrls: [PACT_PATH],
      logLevel: 'error',
      requestFilter: (req, _res, next) => {
        req.headers.authorization = `Bearer ${accessToken}`
        const pending: Promise<unknown>[] = []
        if (req.path.includes(ALBUM_ID)) {
          pending.push(ensureAlbumFixtures())
        }
        // The pact reuses one literal refresh token for logout (revokes it) and
        // refresh (needs it unrevoked) without declaring provider states, so
        // restore the state each interaction assumes.
        if (req.path === '/api/v1/auth/refresh') {
          pending.push(t.refreshRepo.update({ tokenHash: refreshTokenHash }, { revokedAt: null }))
        }
        Promise.all(pending)
          .then(() => next())
          .catch((err: unknown) => next(err))
      },
    })

    const output = await verifier.verifyProvider()
    expect(output).toBeTruthy()
  }, 120_000)
})
