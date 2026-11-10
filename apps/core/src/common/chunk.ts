/**
 * Splits `items` into consecutive batches of at most `size` (default 500), so a bulk
 * `IN (...)` never exceeds Postgres's 65,535 bind-parameter cap. Empty input maps to [].
 */
export function chunk<T>(items: readonly T[], size = 500): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}
