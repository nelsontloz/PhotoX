import * as argon2 from 'argon2'

// pinned so hashes don't silently change with the library's defaults
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} satisfies argon2.HashOptions

// Shared password hasher (argon2id, core dep — never bcrypt). Side-effect-free on purpose:
// the admin:create CLI imports this without pulling the TypeORM entities (which tsx/esbuild
// cannot load — no decorator metadata), unlike users/auth.service.ts.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}
