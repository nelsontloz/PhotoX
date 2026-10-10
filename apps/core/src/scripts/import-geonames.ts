// Import the GeoNames cities500 subset into the `places` table for offline reverse geocoding.
//
// Sources (CC-BY-4.0 — attribution required when redistributed, https://www.geonames.org/):
//   https://download.geonames.org/export/dump/cities500.zip         ~13MB, ~200k cities >500 ppl
// Cache: STORAGE_DIR/geo (default data/storage/geo), reused across runs. Idempotent: no-ops when
// `places` already has rows (--force re-imports), inserts ON CONFLICT DO NOTHING by geonameId.
// Schema comes from the Place entity via TypeORM synchronize (same POSTGRES_* env as core); the
// script lives under src/ so core tsconfig/ESLint cover it.
// Usage: pnpm --filter @photox/core places:import [--force]
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { loadEnv, loadRootEnvFile } from '@photox/shared-config'
import { Place } from '../database/entities/place.entity'
import { parseCityLine, type PlaceRow } from './geonames'

const DUMP_URL = 'https://download.geonames.org/export/dump'
const CITIES_ZIP = 'cities500.zip'
const CITIES_TXT = 'cities500.txt'
const BATCH = 1000

// retry: transient connect timeouts to geonames.org have been observed; write via .part so a
// failed attempt can never leave a truncated cache file behind
async function download(url: string, dest: string): Promise<void> {
  process.stdout.write(`downloading ${url} ... `)
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await writeFile(`${dest}.part`, Buffer.from(await res.arrayBuffer()))
      await rename(`${dest}.part`, dest)
      break
    } catch (err) {
      if (attempt >= 3) throw err
      process.stdout.write(`retry ${attempt}/3 ... `)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
  console.log(`${((await stat(dest)).size / 1024 / 1024).toFixed(1)}MB`)
}

/** Download and unzip as needed; returns the path to cities500.txt. */
async function ensureCache(cacheDir: string): Promise<string> {
  await mkdir(cacheDir, { recursive: true })
  const citiesZip = join(cacheDir, CITIES_ZIP)
  if (!existsSync(citiesZip)) await download(`${DUMP_URL}/${CITIES_ZIP}`, citiesZip)

  const citiesTxt = join(cacheDir, CITIES_TXT)
  if (!existsSync(citiesTxt)) {
    console.log(`extracting ${CITIES_TXT} ...`)
    const unzip = spawnSync(
      'unzip',
      ['-o', join(cacheDir, CITIES_ZIP), CITIES_TXT, '-d', cacheDir],
      {
        stdio: 'inherit',
      },
    )
    if (unzip.status !== 0) throw new Error('unzip failed — install `unzip` to extract the dump')
  }
  return citiesTxt
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  loadRootEnvFile()
  const env = loadEnv()

  // mirrors DatabaseModule.forRoot(); synchronize creates `places` from the entity if core never ran
  const dataSource = new DataSource({
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'photox',
    entities: [Place],
    synchronize: true,
  })
  await dataSource.initialize()

  try {
    const repo = dataSource.getRepository(Place)
    const existing = await repo.count()
    if (existing > 0 && !force) {
      console.log(
        `places already populated (${existing} rows) — skipping (use --force to re-import)`,
      )
      return
    }

    const cacheDir = join(env.STORAGE_DIR, 'geo')
    const citiesTxt = await ensureCache(cacheDir)

    let parsed = 0
    let batch: PlaceRow[] = []
    const lines = createInterface({ input: createReadStream(citiesTxt), crlfDelay: Infinity })
    for await (const line of lines) {
      const row = parseCityLine(line)
      if (row !== null) batch.push(row)
      if (batch.length >= BATCH) {
        await repo.createQueryBuilder().insert().values(batch).orIgnore().execute()
        parsed += batch.length
        batch = []
        if (parsed % 50000 === 0) console.log(`  ... ${parsed} rows`)
      }
    }
    if (batch.length > 0) {
      await repo.createQueryBuilder().insert().values(batch).orIgnore().execute()
      parsed += batch.length
    }

    console.log(`done: parsed ${parsed} cities, places now has ${await repo.count()} rows`)
  } finally {
    await dataSource.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
