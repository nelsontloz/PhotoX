import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PersonDto } from '@photox/shared-types';

const getPersonMock = vi.hoisted(() => vi.fn());

vi.mock('../api/persons', () => ({ getPerson: getPersonMock }));

import { usePersonDetail } from './usePersonDetail';

const person = {
  id: 'p-1',
  name: 'Ada Lovelace',
  faceCount: 3,
} as PersonDto;

const axiosError = (status: number) => ({
  isAxiosError: true,
  response: { status, data: {} },
  message: `status ${status}`,
});

beforeEach(() => {
  getPersonMock.mockResolvedValue(person);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePersonDetail', () => {
  it('returns the person with no error on success', async () => {
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.person).toEqual(person);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(getPersonMock).toHaveBeenCalledWith('p-1');
  });

  it('reports notFound (and no error) on a 404', async () => {
    getPersonMock.mockRejectedValue(axiosError(404));
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.person).toBeNull();
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports an error (and not notFound) on a 500', async () => {
    getPersonMock.mockRejectedValue(axiosError(500));
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.person).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBe('Failed to load person');
  });

  it('reports an error on a network drop with no response', async () => {
    getPersonMock.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBe('Failed to load person');
  });

  it('reports an error (not notFound) on a 403', async () => {
    getPersonMock.mockRejectedValue(axiosError(403));
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBe('Failed to load person');
  });

  it('retry refetches and clears the error on success', async () => {
    getPersonMock.mockRejectedValueOnce(axiosError(500));
    const { result } = renderHook(() => usePersonDetail('p-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load person');

    getPersonMock.mockResolvedValue(person);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.person).toEqual(person));
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(getPersonMock).toHaveBeenCalledTimes(2);
  });
});
