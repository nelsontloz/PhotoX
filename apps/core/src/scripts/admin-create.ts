// Create (or promote to) an admin user. Open registration only mints role 'user', so a
// fresh instance has no admin until the ADMIN_EMAIL/ADMIN_PASSWORD env-seed runs — this is the
// operator recovery tool for when it didn't (empty env, missed seed): it promotes/creates
// regardless of whether an admin already exists, intentionally bypassing the env seed's
// no-admin-exists check.
// Runs under tsx (esbuild emits no decorator metadata), so this file imports NO TypeORM
// entities — all DB access is raw SQL through a bare DataSource, mirroring AdminSeedService.
// Requires the `users` table to exist (core must have started once); the env seed owns the
// first-boot path. The script lives under src/ so core tsconfig/ESLint cover it.
// Usage: pnpm --filter @photox/core admin:create --email=a@b.c --password=secret
import { loadRootEnvFile } from '@photox/shared-config'
import { createScriptDataSource, insertAdminUser } from './admin-seed'
import { parseArgs, validateInput } from './admin-create-args'

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))
  // a missing flag falls through as '' so validateInput reports it with the usual message
  const email = flags.email ?? ''
  const password = flags.password ?? ''
  const invalid = validateInput(email, password)
  if (invalid) throw new Error(invalid)

  loadRootEnvFile()
  const dataSource = createScriptDataSource()
  await dataSource.initialize()

  try {
    const existing: { id: string }[] = await dataSource.query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    )
    if (existing.length > 0) {
      await dataSource.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [email])
      console.log(`promoted ${email} to admin`)
      return
    }
    await insertAdminUser(dataSource, email, password, email.split('@')[0] ?? email)
    console.log(`created admin ${email}`)
  } finally {
    await dataSource.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
