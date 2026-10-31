import { describe, expect, it } from 'vitest'
import { unionBackupManifests, type UserBackupManifest } from './user-backup.service'

const USER = '11111111-1111-4111-8111-111111111111'
const FILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const FILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const ASSET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const ASSET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'
const ALBUM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const ALBUM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6'
const PERSON_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'
const PERSON_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8'
const SHARE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
const SHARE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba'
const SHARE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function manifest(over: Partial<UserBackupManifest> = {}): UserBackupManifest {
  return {
    manifestVersion: 1,
    userId: USER,
    emailAtBackup: 'ada@example.com',
    backedUpAt: '2026-01-01T00:00:00.000Z',
    user: {
      id: USER,
      email: 'ada@example.com',
      role: 'user',
      passwordHash: 'hash',
      displayName: 'Ada',
      tokensValidAfter: null,
    },
    files: [],
    assets: [],
    albums: [],
    albumAssets: [],
    shares: [],
    persons: [],
    ...over,
  }
}

function fileEntry(
  id: string,
  over: Partial<UserBackupManifest['files'][number]> = {},
): UserBackupManifest['files'][number] {
  return {
    id,
    userId: USER,
    storageKey: `originals/${id}.jpg`,
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    checksumSha256: `checksum-${id}`,
    purpose: 'original',
    assetId: null,
    ...over,
  }
}

function assetEntry(
  id: string,
  over: Partial<UserBackupManifest['assets'][number]> = {},
): UserBackupManifest['assets'][number] {
  return {
    id,
    userId: USER,
    kind: 'photo',
    fileId: FILE_A,
    isTrashed: false,
    trashedAt: null,
    title: `title-${id}`,
    description: null,
    takenAt: null,
    favorite: false,
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    originalName: `${id}.jpg`,
    width: 10,
    height: 10,
    durationSeconds: null,
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    orientation: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    focalLength: null,
    latitude: null,
    longitude: null,
    altitude: null,
    placeCity: null,
    placeAdmin1: null,
    placeCountryCode: null,
    placeTimezone: null,
    placeDistanceKm: null,
    fps: null,
    codec: null,
    hasAudio: null,
    metadata: null,
    metadataStatus: 'ready',
    transcodeStatus: null,
    thumbnailStatus: 'ready',
    faceStatus: null,
    embeddingStatus: null,
    faceCount: null,
    ...over,
  }
}

function albumEntry(
  id: string,
  over: Partial<UserBackupManifest['albums'][number]> = {},
): UserBackupManifest['albums'][number] {
  return { id, userId: USER, name: `album-${id}`, description: null, ...over }
}

function personEntry(
  id: string,
  over: Partial<UserBackupManifest['persons'][number]> = {},
): UserBackupManifest['persons'][number] {
  return { id, userId: USER, name: `person-${id}`, clusterLabel: null, faceCount: 1, ...over }
}

function shareEntry(
  id: string,
  over: Partial<UserBackupManifest['shares'][number]> = {},
): UserBackupManifest['shares'][number] {
  return {
    id,
    userId: USER,
    kind: 'asset',
    assetId: ASSET_A,
    albumId: null,
    token: `token-${id}`,
    expiresAt: null,
    ...over,
  }
}

describe('unionBackupManifests', () => {
  it('returns the adopted manifest when the live account has no backup', () => {
    const adopted = manifest({
      files: [fileEntry(FILE_B)],
      assets: [assetEntry(ASSET_B)],
      albums: [albumEntry(ALBUM_B)],
      persons: [personEntry(PERSON_B)],
      shares: [shareEntry(SHARE_B)],
    })

    expect(unionBackupManifests(null, adopted)).toEqual(adopted)
  })

  it('appends adopted-only entries after live entries in every collection', () => {
    const live = manifest({
      files: [fileEntry(FILE_A)],
      assets: [assetEntry(ASSET_A)],
      albums: [albumEntry(ALBUM_A)],
      persons: [personEntry(PERSON_A)],
      shares: [shareEntry(SHARE_A)],
      albumAssets: [{ albumId: ALBUM_A, assetId: ASSET_A }],
    })
    const adopted = manifest({
      files: [fileEntry(FILE_B)],
      assets: [assetEntry(ASSET_B)],
      albums: [albumEntry(ALBUM_B)],
      persons: [personEntry(PERSON_B)],
      shares: [shareEntry(SHARE_B)],
      albumAssets: [{ albumId: ALBUM_B, assetId: ASSET_B }],
    })

    const result = unionBackupManifests(live, adopted)
    expect(result.files.map((entry) => entry.id)).toEqual([FILE_A, FILE_B])
    expect(result.assets.map((entry) => entry.id)).toEqual([ASSET_A, ASSET_B])
    expect(result.albums.map((entry) => entry.id)).toEqual([ALBUM_A, ALBUM_B])
    expect(result.persons.map((entry) => entry.id)).toEqual([PERSON_A, PERSON_B])
    expect(result.shares.map((entry) => entry.id)).toEqual([SHARE_A, SHARE_B])
    expect(result.albumAssets).toEqual([
      { albumId: ALBUM_A, assetId: ASSET_A },
      { albumId: ALBUM_B, assetId: ASSET_B },
    ])
  })

  it('keeps live entries on id collisions (files, assets, albums, persons, shares)', () => {
    const live = manifest({
      files: [fileEntry(FILE_A, { originalName: 'live.jpg' })],
      assets: [assetEntry(ASSET_A, { title: 'live title' })],
      albums: [albumEntry(ALBUM_A, { name: 'live album' })],
      persons: [personEntry(PERSON_A, { name: 'live person' })],
      shares: [shareEntry(SHARE_A, { token: 'live-token' })],
    })
    const adopted = manifest({
      files: [fileEntry(FILE_A, { originalName: 'adopted.jpg' })],
      assets: [assetEntry(ASSET_A, { title: 'adopted title' })],
      albums: [albumEntry(ALBUM_A, { name: 'adopted album' })],
      persons: [personEntry(PERSON_A, { name: 'adopted person' })],
      shares: [shareEntry(SHARE_A, { token: 'adopted-token' })],
    })

    const result = unionBackupManifests(live, adopted)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.originalName).toBe('live.jpg')
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]?.title).toBe('live title')
    expect(result.albums).toHaveLength(1)
    expect(result.albums[0]?.name).toBe('live album')
    expect(result.persons).toHaveLength(1)
    expect(result.persons[0]?.name).toBe('live person')
    expect(result.shares).toHaveLength(1)
    expect(result.shares[0]?.token).toBe('live-token')
  })

  it('dedupes shares by token as well as id, live winning', () => {
    const live = manifest({ shares: [shareEntry(SHARE_A, { token: 'shared-token' })] })
    const adopted = manifest({
      shares: [
        shareEntry(SHARE_B, { token: 'shared-token' }),
        shareEntry(SHARE_C, { token: 'unique-token' }),
      ],
    })

    const result = unionBackupManifests(live, adopted)
    expect(result.shares).toHaveLength(2)
    expect(result.shares[0]?.token).toBe('shared-token')
    expect(result.shares[1]?.token).toBe('unique-token')
  })

  it('dedupes album links by (albumId, assetId) pair', () => {
    const live = manifest({
      albumAssets: [{ albumId: ALBUM_A, assetId: ASSET_A }],
    })
    const adopted = manifest({
      albumAssets: [
        { albumId: ALBUM_A, assetId: ASSET_A },
        { albumId: ALBUM_A, assetId: ASSET_B },
      ],
    })

    const result = unionBackupManifests(live, adopted)
    expect(result.albumAssets).toEqual([
      { albumId: ALBUM_A, assetId: ASSET_A },
      { albumId: ALBUM_A, assetId: ASSET_B },
    ])
  })

  it('takes the newer backedUpAt from either side', () => {
    const older = manifest({ backedUpAt: '2026-01-01T00:00:00.000Z' })
    const newer = manifest({ backedUpAt: '2026-06-01T00:00:00.000Z' })

    expect(unionBackupManifests(older, newer).backedUpAt).toBe(newer.backedUpAt)
    expect(unionBackupManifests(newer, older).backedUpAt).toBe(newer.backedUpAt)
  })

  it('takes top-level identity from the adopted manifest', () => {
    const adopted = manifest({
      emailAtBackup: 'new-address@example.com',
      user: {
        id: USER,
        email: 'new-address@example.com',
        role: 'user',
        passwordHash: 'hash',
        displayName: 'New Name',
        tokensValidAfter: null,
      },
    })

    const result = unionBackupManifests(manifest(), adopted)
    expect(result.userId).toBe(adopted.userId)
    expect(result.emailAtBackup).toBe('new-address@example.com')
    expect(result.user.displayName).toBe('New Name')
  })

  it('round-trips through JSON as a schema-valid manifest', () => {
    const live = manifest({
      files: [fileEntry(FILE_A)],
      assets: [assetEntry(ASSET_A)],
      albumAssets: [{ albumId: ALBUM_A, assetId: ASSET_A }],
    })
    const adopted = manifest({
      files: [fileEntry(FILE_B)],
      assets: [assetEntry(ASSET_B)],
      shares: [shareEntry(SHARE_B)],
    })
    const result = unionBackupManifests(live, adopted)
    const roundTripped = JSON.parse(JSON.stringify(result)) as UserBackupManifest

    // union(null, …) returns the adopted manifest unchanged, so the round-trip is lossless
    expect(unionBackupManifests(null, roundTripped)).toEqual(result)
  })
})
