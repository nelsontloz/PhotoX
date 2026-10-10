import { api } from './client'
import type { PersonListResponse, PersonDto } from '@photox/shared-types'

export async function listPersons(
  params: { limit?: number; offset?: number } = {},
): Promise<PersonListResponse> {
  const { data } = await api.get<PersonListResponse>('/v1/persons', { params })
  return data
}

// ponytail: page through until total — personal libraries are small; 200/page is plenty
export async function listAllPersons(): Promise<PersonDto[]> {
  const items: PersonDto[] = []
  for (;;) {
    const res = await listPersons({ limit: 200, offset: items.length })
    items.push(...res.items)
    if (res.items.length === 0 || items.length >= res.total) return items
  }
}

export async function getPerson(id: string): Promise<PersonDto> {
  const { data } = await api.get<PersonDto>(`/v1/persons/${id}`)
  return data
}

export async function renamePerson(id: string, name: string | null): Promise<PersonDto> {
  const { data } = await api.patch<PersonDto>(`/v1/persons/${id}`, { name })
  return data
}

export async function triggerCluster(): Promise<{ queued: boolean; jobId: string }> {
  const { data } = await api.post<{ queued: boolean; jobId: string }>('/v1/persons/cluster')
  return data
}
