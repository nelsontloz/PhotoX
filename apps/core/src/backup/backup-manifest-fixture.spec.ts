import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { userBackupManifestSchema } from './backup.types';

const fixturePath = join(__dirname, '__fixtures__/manifest.v1.json');

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
}

describe('userBackupManifestSchema against a stored v1 manifest', () => {
  it('parses a fixture with one entry in every section', () => {
    const manifest = userBackupManifestSchema.parse(fixture());
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.albums).toHaveLength(1);
    expect(manifest.albumAssets).toHaveLength(1);
    expect(manifest.shares).toHaveLength(1);
    expect(manifest.persons).toHaveLength(1);
  });

  it('defaults an album without hiddenFromTimeline to visible', () => {
    const raw = fixture();
    const albums = raw.albums as Record<string, unknown>[];
    delete albums[0]!.hiddenFromTimeline;

    const manifest = userBackupManifestSchema.parse(raw);
    expect(manifest.albums[0]!.hiddenFromTimeline).toBe(false);
  });

  it('rejects manifestVersion 2', () => {
    const raw = fixture();
    raw.manifestVersion = 2;
    expect(userBackupManifestSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a manifest without a files section', () => {
    const raw = fixture();
    delete raw.files;
    expect(userBackupManifestSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a non-uuid user.id', () => {
    const raw = fixture();
    (raw.user as Record<string, unknown>).id = 'not-a-uuid';
    expect(userBackupManifestSchema.safeParse(raw).success).toBe(false);
  });
});
