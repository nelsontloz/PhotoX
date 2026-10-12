// Pure arg parsing/validation for the admin:create CLI (side-effect-free so the spec can
// import it; same split as geonames.ts vs import-geonames.ts).
// Validation mirrors RegisterDto: pragmatic email shape (class-validator @IsEmail is stricter)
// + the same 8..128 password bounds.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseArgs(argv: string[]): { email?: string; password?: string } {
  const out: { email?: string; password?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    for (const key of ['email', 'password'] as const) {
      if (arg === `--${key}`) {
        const value = argv[i + 1]
        if (value !== undefined) out[key] = value
      } else if (arg.startsWith(`--${key}=`)) {
        out[key] = arg.slice(key.length + 3)
      }
    }
  }
  return out
}

/** null when valid, otherwise the message main() prints before exiting non-zero. */
export function validateInput(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return `invalid email: ${email}`
  if (password.length < 8 || password.length > 128) {
    return 'password must be 8..128 characters (same bounds as registration)'
  }
  return null
}
