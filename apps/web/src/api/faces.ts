import { api } from './client'

export async function downloadFaceThumb(
  faceId: string,
  size?: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const { data } = await api.get<Blob>(`/v1/faces/${faceId}/thumb`, {
    responseType: 'blob',
    signal,
    params: size ? { size } : undefined,
  })
  return data
}

export async function assignFace(faceId: string, personId: string | null): Promise<void> {
  await api.patch(`/v1/faces/${faceId}/person`, { personId })
}
