// Create (or promote to) an admin user. Open registration only mints role 'user', so a
// fresh instance has no admin until the ADMIN_EMAIL/ADMIN_PASSWORD env-seed runs — this is the
// operator recovery tool for when it didn't (empty env, missed seed): it promotes/creates
// regardless of whether an admin already exists, intentionally bypassing the env seed's
// no-admin-exists check.
// Runs under tsx (esbuild emits no decorator metadata), so this file imports NO TypeORM
// entities — all DB access is raw SQL through a bare DataSource, mirroring AdminSeedService.
// Requires the `users` table to exist (core must have started once); the env seed owns the
// first-boot path. The script lives under src/ so core tsconfig/ESLint cover it.
// Usage: pnpm --filter @photox/core admin:create [--email=a@b.c --password=secret]
import { stdin as input } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { loadRootEnvFile } from '@photox/shared-config'
import { createScriptDataSource, insertAdminUser } from './admin-seed'
import { parseArgs, validateInput } from './admin-create-args'

interface Prompt {
  text: string
  hidden: boolean
  trim: boolean
}

// readline has no hidden-input mode: a muted output keeps the password off-screen while
// readline still owns line editing (backspace) and terminal signals (Ctrl-C/EOF).
class PromptOutput extends Writable {
  muted = false

  override _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) process.stdout.write(chunk, encoding)
    callback()
  }
}

// One interface for the whole session — readline buffers piped lines, so a second interface
// on stdin would drop input already pulled from the stream.
async function promptAll(questions: Prompt[]): Promise<string[]> {
  const output = new PromptOutput()
  const rl = createInterface({ input, output, terminal: input.isTTY })
  const lines = rl[Symbol.asyncIterator]()
  let interrupted = false
  rl.on('SIGINT', () => {
    interrupted = true
    rl.close()
  })
  try {
    const answers: string[] = []
    for (const question of questions) {
      rl.setPrompt(question.text)
      rl.prompt()
      output.muted = question.hidden
      const line = await lines.next()
      output.muted = false
      if (line.done) throw new Error(interrupted ? 'interrupted' : 'unexpected end of input')
      if (question.hidden) process.stdout.write('\n')
      answers.push(question.trim ? line.value.trim() : line.value)
    }
    return answers
  } finally {
    rl.close()
  }
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
