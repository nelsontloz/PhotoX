/** Shared async backoff: poll loops (admin deletes) and transient retries (auth refresh). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
