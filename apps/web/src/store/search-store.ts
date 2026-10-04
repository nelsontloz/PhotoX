import { create } from 'zustand'
import { isAxiosError } from 'axios'
import type { Asset } from '@photox/shared-types'
import { searchAssets } from '../api/search'
import { useAuthStore } from './auth-store'

export const SEARCH_PAGE_SIZE = 50

interface SearchState {
  query: string
  items: Asset[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  run: (q: string, force?: boolean) => Promise<void>
  loadMore: () => Promise<void>
  reset: () => void
}

function errorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.status === 503) {
    return 'Search is not ready yet. The search index is still being built — try again in a moment.'
  }
  return 'Search failed. Please try again.'
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  items: [],
  total: 0,
  loading: false,
  loadingMore: false,
  error: null,

  // Same query already loaded (or in flight) is a no-op — the results page and the header's
  // Back/forward sync both call run() on mount. `force` skips that for retries and post-edit
  // refreshes.
  run: async (q, force = false) => {
    const query = q.trim()
    if (!query) {
      get().reset()
      return
    }
    const state = get()
    if (!force && query === state.query && (state.loading || state.items.length > 0)) return
    set({ query, items: [], total: 0, loading: true, loadingMore: false, error: null })
    try {
      const res = await searchAssets({ q: query, limit: SEARCH_PAGE_SIZE, offset: 0 })
      if (get().query !== query) return // a newer query superseded this one
      set({ items: res.items, total: res.total, loading: false })
    } catch (err) {
      if (get().query !== query) return
      set({ loading: false, error: errorMessage(err) })
    }
  },

  loadMore: async () => {
    const { query, items, total, loading, loadingMore } = get()
    if (!query || loading || loadingMore || items.length >= total) return
    set({ loadingMore: true, error: null })
    try {
      const res = await searchAssets({ q: query, limit: SEARCH_PAGE_SIZE, offset: items.length })
      if (get().query !== query) return
      // dedupe by id: a concurrent edit can shift offsets between pages
      const seen = new Set(get().items.map((a) => a.id))
      set({
        items: [...get().items, ...res.items.filter((a) => !seen.has(a.id))],
        total: res.total,
        loadingMore: false,
      })
    } catch (err) {
      if (get().query !== query) return
      set({ loadingMore: false, error: errorMessage(err) })
    }
  },

  reset: () =>
    set({ query: '', items: [], total: 0, loading: false, loadingMore: false, error: null }),
}))

// Results belong to the logged-in user: drop them when the session ends so a later login can
// never read a previous user's cached results through run()'s same-query dedupe.
useAuthStore.subscribe((state) => {
  if (!state.accessToken) useSearchStore.getState().reset()
})
