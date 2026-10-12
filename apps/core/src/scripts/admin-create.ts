// Create (or promote to) an admin user. Open registration only mints role 'user', so a
// fresh instance has no admin until the ADMIN_EMAIL/ADMIN_PASSWORD env-seed runs — this is the
// operator recovery tool for when it didn't (empty env, missed seed): it promotes/creates
// regardless of whether an admin already exists, intentionally bypassing the env seed's
// no-admin-exists check.
// Runs under tsx (esbuild emits no decorator metadata), so this file imports NO TypeORM
// entities — all DB access is raw SQL through a bare DataSource, mirroring ADMIN_SEED_PROVIDER.
// Requires the `users` table to exist (core must have started once); the env seed owns the
// first-boot path. The script lives under src/ so core tsconfig/ESLint cover it.
// Usage: pnpm --filter @photox/core admin:create [--email=a@b.c --password=secret]
import { stdin as input, stdout as output } from 'node:process'
import { randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import { loadEnv, loadRootEnvFile } from '@photox/shared-config'
import { hashPassword } from '../users/password'
import { parseArgs, validateInput } from './admin-create-args'

interface Prompt {
  text: string
  hidden: boolean
  trim: boolean
}

// One persistent stdin consumer for the whole interactive session (a second listener would race
// readline's buffering and drop piped lines). Hidden prompts echo nothing; visible ones echo
// back in raw mode. No new deps.
function promptAll(questions: Prompt[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const answers: string[] = []
    let value = ''
    let done = false
    let qi = 0
    output.write(questions[0]?.text ?? '')
    const cleanup = (): void => {
      done = true
      input.removeListener('data', onData)
      input.removeListener('end', onEnd)
      if (input.isTTY) input.setRawMode(false)
      input.pause()
    }
    const onEnd = (): void => {
      if (!done) {
        cleanup()
        reject(new Error('unexpected end of input'))
      }
    }
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf8').replace(/\r\n?/g, '\n')) {
        if (done) return
        const hidden = questions[qi]?.hidden ?? false
        if (char === '\n') {
          answers.push(questions[qi]?.trim === true ? value.trim() : value)
          value = ''
          output.write('\n')
          qi += 1
          if (qi >= questions.length) {
            cleanup()
            resolve(answers)
            return
          }
          output.write(questions[qi]?.text ?? '')
          continue
        }
        if (char === '\u0003') {
          cleanup()
          reject(new Error('interrupted'))
          return
        }
        // backspace erases one char from the buffer (hidden input was never echoed)
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            if (input.isTTY && !hidden) output.write('\b \b')
          }
          continue
        }
        value += char
        if (input.isTTY && !hidden) output.write(char)
      }
    }
    if (input.isTTY) input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    input.once('end', onEnd)
  })
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))
  const missing: Prompt[] = []
  if (flags.email === undefined) missing.push({ text: 'admin email: ', hidden: false, trim: true })
  if (flags.password === undefined) {
    missing.push({ text: 'admin password: ', hidden: true, trim: false })
  }
  const interactive = missing.length > 0 ? await promptAll(missing) : []
  let ai = 0
  const email = flags.email ?? interactive[ai++] ?? ''
  const password = flags.password ?? interactive[ai] ?? ''
  const invalid = validateInput(email, password)
  if (invalid) throw new Error(invalid)

  loadRootEnvFile()
  const env = loadEnv()

  // no entities and no synchronize: read/update only, never DDL (core owns the schema)
  const dataSource = new DataSource({
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'photox',
  })
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
    await dataSource.query(
      `INSERT INTO users (id, email, role, "passwordHash", "displayName") ` +
        `VALUES ($1, $2, 'admin', $3, $4)`,
      [randomUUID(), email, await hashPassword(password), email.split('@')[0] ?? email],
    )
    console.log(`created admin ${email}`)
  } finally {
    await dataSource.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
