import { api } from './client'

export async function assignFace(faceId: string, personId: string | null): Promise<void> {
  await api.patch(`/v1/faces/${faceId}/person`, { personId })
}
