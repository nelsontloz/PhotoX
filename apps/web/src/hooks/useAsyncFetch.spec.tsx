import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsyncFetch } from './useAsyncFetch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncFetch concurrent refresh', () => {
  it('shares one in-flight request per key and resolves both callers after the data arrives', async () => {
    const request = deferred<string>();
    const fetcher = vi.fn(() => request.promise);
    const { result } = renderHook(() => useAsyncFetch(fetcher, { errorMessage: 'boom' }));
    expect(fetcher).toHaveBeenCalledTimes(1); // the initial effect fetch is in flight

    let firstDone = false;
    let secondDone = false;
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.refresh().then(() => {
        firstDone = true;
      });
      p2 = result.current.refresh().then(() => {
        secondDone = true;
      });
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);

    await act(async () => {
      request.resolve('fresh');
      await Promise.all([p1, p2]);
    });

    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
    expect(result.current.data).toBe('fresh');
  });

  it('keeps a post-mutation caller waiting instead of resolving with stale data', async () => {
    const request = deferred<string>();
    const fetcher = vi.fn(() => request.promise);
    const { result } = renderHook(() => useAsyncFetch(fetcher, { errorMessage: 'boom' }));

    let settled = false;
    const mutation = result.current.refresh().then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await act(async () => {
      request.resolve('after-mutation');
      await mutation;
    });

    expect(settled).toBe(true);
    expect(result.current.data).toBe('after-mutation');
  });
});
