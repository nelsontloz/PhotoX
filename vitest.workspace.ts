import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'apps/gateway',
  'apps/user-service',
  'apps/media-service',
  'apps/file-storage-service',
  'apps/worker-service',
  'apps/web',
  'packages/shared-auth',
  'packages/shared-config',
  'packages/shared-events',
  'packages/shared-redis',
  'packages/shared-types',
  'scripts',
])
