/** The operations a Swagger path item can carry, in the order both document walkers visit them. */
export const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type HttpMethod = (typeof METHODS)[number];
