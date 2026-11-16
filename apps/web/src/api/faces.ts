import { api } from './client';
import type { FaceDto } from '@photox/shared-types';

// PUT, not PATCH: this replaces the face's person (null clears it) and is idempotent.
export async function assignFace(faceId: string, personId: string | null): Promise<FaceDto> {
  const { data } = await api.put<FaceDto>(`/v1/faces/${faceId}/person`, { personId });
  return data;
}
