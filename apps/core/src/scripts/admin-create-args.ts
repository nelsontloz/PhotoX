// Pure arg parsing/validation for the admin:create CLI (side-effect-free so the spec can
// import it; same split as geonames.ts vs import-geonames.ts).
// Validation mirrors RegisterDto: pragmatic email shape (class-validator @IsEmail is stricter)
// + the same 8..128 password bounds.
import { parseArgs as parseNodeArgs } from 'node:util';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseArgs(argv: string[]): { email?: string; password?: string } {
  try {
    const { values } = parseNodeArgs({
      args: argv,
      options: { email: { type: 'string' }, password: { type: 'string' } },
      // unknown flags land in positionals (ignored) — same tolerance as the hand-rolled loop
      strict: false,
      allowPositionals: true,
    });
    const out: { email?: string; password?: string } = {};
    if (typeof values.email === 'string') out.email = values.email;
    if (typeof values.password === 'string') out.password = values.password;
    return out;
  } catch {
    // e.g. a dangling `--email` with no value: treat as absent (old loop skipped it too)
    return {};
  }
}

/** null when valid, otherwise the message main() prints before exiting non-zero. */
export function validateInput(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return `invalid email: ${email}`;
  if (password.length < 8 || password.length > 128) {
    return 'password must be 8..128 characters (same bounds as registration)';
  }
  return null;
}
