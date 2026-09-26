import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'apps/core',
  'apps/worker-service',
  'apps/web',
  'packages/shared-auth',
  'packages/shared-config',
  'packages/shared-types',
  'scripts',
])
