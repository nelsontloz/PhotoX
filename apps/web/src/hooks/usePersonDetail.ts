import { isAxiosError } from 'axios'
import type { PersonDto } from '@photox/shared-types'
import { getPerson } from '../api/persons'
import { useAsyncFetch } from './useAsyncFetch'

/**
 * Person header data. `null` data means the person is gone (404) — outages are errors, never
 * "not found", because they are not deletions.
 */
export function usePersonDetail(id: string | undefined) {
  const { data, loading, error, refresh, setData } = useAsyncFetch<PersonDto | null>(
    async () => {
      if (!id) return null
      try {
        return await getPerson(id)
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) return null
        // 500s, network drops and 403s are outages, not deletions — never leak axios verbatim.
        throw new Error('Failed to load person', { cause: err })
      }
    },
    { errorMessage: 'Failed to load person', loadingMode: 'always' },
  )

  return {
    person: data ?? null,
    setPerson: setData,
    loading,
    error,
    notFound: data === null,
    retry: () => {
      void refresh()
    },
  }
}
