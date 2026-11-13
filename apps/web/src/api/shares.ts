import { api } from './client';
import type { CreateShareRequest, ShareDto, ShareListResponse } from '@photox/shared-types';

export async function createShare(target: CreateShareRequest): Promise<ShareDto> {
  const { data } = await api.post<ShareDto>('/v1/shares', target);
  return data;
}

/** Walks every keyset page — the page renders the whole list, so it must not stop at the cap. */
export async function listShares(): Promise<ShareListResponse> {
  const items: ShareListResponse['items'] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data } = await api.get<ShareListResponse>('/v1/shares', {
      params: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    items.push(...data.items);
    if (!data.nextCursor || data.nextCursor === cursor) return { items, total: data.total };
    cursor = data.nextCursor;
  }
}

export async function revokeShare(shareId: string): Promise<void> {
  await api.delete(`/v1/shares/${shareId}`);
}

export function getShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}
