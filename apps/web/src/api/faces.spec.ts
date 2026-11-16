import { describe, it, expect, vi, beforeEach } from 'vitest';

const putMock = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ api: { put: putMock } }));

import { assignFace } from './faces';

describe('assignFace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ data: { id: 'face-1', personId: 'person-1' } });
  });

  it('puts the face person endpoint with the target personId', async () => {
    await assignFace('face-1', 'person-1');
    expect(putMock).toHaveBeenCalledWith('/v1/faces/face-1/person', { personId: 'person-1' });
  });

  it('sends personId null to unassign', async () => {
    await assignFace('face-1', null);
    expect(putMock).toHaveBeenCalledWith('/v1/faces/face-1/person', { personId: null });
  });
});
