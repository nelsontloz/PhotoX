import { api } from './client'
import type {
  PersonListResponse,
  PersonDto,
  PersonAssetsResponse,
  ReassignFacesResponse,
} from '@photox/shared-types'

export async function listPersons(
  params: { limit?: number; offset?: number } = {},
): Promise<PersonListResponse> {
  const { data } = await api.get<PersonListResponse>('/v1/persons', { params })
  return data
}

export async function getPerson(id: string): Promise<PersonDto> {
  const { data } = await api.get<PersonDto>(`/v1/persons/${id}`)
  return data
}

export async function renamePerson(id: string, name: string | null): Promise<PersonDto> {
  const { data } = await api.patch<PersonDto>(`/v1/persons/${id}`, { name })
  return data
}

export async function getPersonAssets(
  id: string,
  params: { limit?: number; offset?: number } = {},
): Promise<PersonAssetsResponse> {
  const { data } = await api.get<PersonAssetsResponse>(`/v1/persons/${id}/assets`, { params })
  return data
}

export async function reassignFaces(
  personId: string,
  body: { toPersonId: string | null; faceIds: string[] },
): Promise<ReassignFacesResponse> {
  const { data } = await api.post<ReassignFacesResponse>(`/v1/persons/${personId}/reassign`, body)
  return data
}

export async function triggerCluster(): Promise<{ queued: boolean; jobId: string }> {
  const { data } = await api.post<{ queued: boolean; jobId: string }>('/v1/persons/cluster')
  return data
}
