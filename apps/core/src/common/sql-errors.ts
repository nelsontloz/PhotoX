import { QueryFailedError } from 'typeorm';

// ponytail: pg code only — the only prod driver; sqlite/test callers never hit this branch.
// Lives in common/ because auth, admin, shares, backup and uploads all need the same verdict.
export function isPostgresUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driver = err.driverError as { code?: unknown } | null | undefined;
  return driver?.code === '23505';
}
