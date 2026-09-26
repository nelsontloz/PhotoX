// Usage: pnpm exec tsx scripts/migrate-storage-layout.ts [--apply] [--batch=N]
// ponytail: one-off backfill flat -> prefixed layout, remove once every env has migrated
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { loadEnv } from '../packages/shared-config/src/env.js'

// ponytail: scripts/ is no workspace package, so bare @photox/typeorm imports fail here;
// relative imports + createRequire reuse the existing installs, no new deps
const requirePkg = createRequire(join(process.cwd(), 'packages/data-access/package.json'))
const Orm = requirePkg('typeorm') as { DataSource: new (options: object) => Db }

interface Db {
  initialize(): Promise<void>
  destroy(): Promise<void>
  query(sql: string, params?: unknown[]): Promise<unknown>
}

interface FileRow {
  id: string
  userId: string
  storageKey: string
  purpose: string
}

function mapKey(row: FileRow): string | null {
  const { storageKey, userId, purpose } = row
  if (['originals/', 'derivatives/', 'models/'].some((p) => storageKey.startsWith(p))) return null
  const base = storageKey.slice(storageKey.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const ext = dot < 0 ? '' : base.slice(dot).toLowerCase()
  if (purpose === 'transcode' || ext === '.webm') return `derivatives/transcodes/${userId}/${base}`
  if (ext === '.webp') return `derivatives/thumbnails/${userId}/${base}`
  return `originals/${userId}/${base}`
}

async function moveFile(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(src, dest)
    await unlink(src).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const apply = args.has('--apply')
  const raw = [...args].find((a) => a.startsWith('--batch='))?.split('=')[1]
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  const batch = Number.isInteger(parsed) && parsed > 0 ? parsed : 500
  const env = loadEnv()
  // ponytail: mirrors SharedDatabaseModule.forRoot() but synchronize:false,
  // scripts must not touch schema
  const ds = new Orm.DataSource({
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'photox',
    synchronize: false,
  })
  await ds.initialize()
  const counts = { moved: 0, skipped: 0, missing: 0 }
  try {
    for (let skip = 0; ; skip += batch) {
      const rows = (await ds.query(
        'SELECT id, "userId", "storageKey", purpose FROM files ORDER BY id ASC LIMIT $1 OFFSET $2',
        [batch, skip],
      )) as FileRow[]
      if (rows.length === 0) break
      for (const row of rows) {
        const dest = mapKey(row)
        if (dest === null) {
          counts.skipped += 1
          continue
        }
        const srcPath = join(env.STORAGE_DIR, row.storageKey)
        const destPath = join(env.STORAGE_DIR, dest)
        const srcExists = await stat(srcPath)
          .then(() => true)
          .catch(() => false)
        if (srcExists === false) {
          counts.missing += 1
          console.log(`missing source, DB untouched: ${row.storageKey}`)
          continue
        }
        const destExists = await stat(destPath)
          .then(() => true)
          .catch(() => false)
        if (destExists) {
          counts.skipped += 1
          continue
        }
        console.log(`${apply ? 'move' : 'would move'} ${row.storageKey} -> ${dest}`)
        if (apply) {
          await moveFile(srcPath, destPath)
          await ds.query('UPDATE files SET "storageKey" = $1 WHERE id = $2', [dest, row.id])
        }
        counts.moved += 1
      }
    }
  } finally {
    await ds.destroy()
  }
  const mode = apply ? 'apply' : 'dry-run'
  console.log(`${mode}: moved=${counts.moved} skipped=${counts.skipped} missing=${counts.missing}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
