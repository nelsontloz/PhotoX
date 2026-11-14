import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One home for the `Asset` table.
 *
 * `Repository<Asset>` outside `assets/` is how the ownership rule erodes: every caller picks its
 * own `where` clause and its own idea of "trashed". Features read assets through
 * `AssetsService`, which returns narrow shapes (`{id, fileId}`, `Set<string>`) instead of the
 * entity — a caller can learn about an asset, not mutate one.
 *
 * Each allowlisted directory names something `AssetsService` cannot express; remove the entry
 * when the reason stops being true (the second test fails if an exemption goes unused).
 */
const ASSET_REPO_OWNERS: Record<string, string> = {
  assets: 'owns the table',
  backup: 'declared cross-cutting ledger reader (docs/backups-contract.md)',
  admin: "admin surface writes any user's asset (place backfill, orphan cleanup)",
  shares: 'token-scoped public share reads have no userId to scope by',
  faces: 'AssetsModule imports FacesModule, so faces cannot depend back without a cycle',
};

const ASSET_REPO = /Repository<\s*Asset\s*>/;

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .filter((entry) => !entry.name.endsWith('.spec.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function assetRepoDirs(root: string): Set<string> {
  const dirs = new Set<string>();
  for (const file of sourceFiles(root)) {
    if (!ASSET_REPO.test(readFileSync(file, 'utf8'))) continue;
    dirs.add(relative(root, file).split('/')[0]!);
  }
  return dirs;
}

describe('asset table ownership', () => {
  const root = __dirname;

  it('reads assets through AssetsService everywhere except the allowlist', () => {
    const used = assetRepoDirs(root);
    // the scan itself must see the owner, or a broken glob would make this spec a green no-op
    expect(used.has('assets')).toBe(true);
    expect([...used].filter((dir) => !(dir in ASSET_REPO_OWNERS))).toEqual([]);
  });

  it('keeps no allowlist entry that no longer injects Repository<Asset>', () => {
    const used = assetRepoDirs(root);
    const stale = Object.keys(ASSET_REPO_OWNERS).filter((dir) => !used.has(dir));
    expect(stale).toEqual([]);
  });
});
