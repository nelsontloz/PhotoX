import { access } from 'fs/promises'

// ponytail: memoize an async factory; a rejected promise is cleared so a later call retries — the
// first jobs can run before a model is provisioned and must not poison every later job until a
// worker restart
export function lazyOnce<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    promise ??= factory().catch((err: unknown) => {
      promise = null
      throw err
    })
    return promise
  }
}

// rejects with `message` when the model file (or dir marker) is missing
export async function requireModelFile(path: string, message: string): Promise<void> {
  try {
    await access(path)
  } catch {
    throw new Error(message)
  }
}
