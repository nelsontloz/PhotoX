import { isAdminRoute, isOpenRoute, isWorkerRoute } from './open-routes';

/**
 * The access rules must not depend on the casing of the URL: the router matches routes
 * case-insensitively, so `/API/V1/ADMIN/USERS` resolves to the very same route as
 * `/api/v1/admin/users`. A case-sensitive prefix comparison let the URL's casing decide
 * the policy (API security audit, findings #1-#3).
 */
describe('open-routes', () => {
  describe('isAdminRoute', () => {
    it('matches the admin namespace and its children', () => {
      expect(isAdminRoute('/api/v1/admin')).toBe(true);
      expect(isAdminRoute('/api/v1/admin/users')).toBe(true);
      expect(isAdminRoute('/api/v1/admin/users/123')).toBe(true);
      expect(isAdminRoute('/api/v1/admin/cleanup-orphans/run')).toBe(true);
    });

    it('does not match lookalike paths', () => {
      expect(isAdminRoute('/api/v1/administrator')).toBe(false);
      expect(isAdminRoute('/api/v1/adminx/users')).toBe(false);
      expect(isAdminRoute('/api/v1/users')).toBe(false);
      expect(isAdminRoute('/worker/assets')).toBe(false);
    });

    it('ignores the case of the path', () => {
      expect(isAdminRoute('/API/V1/ADMIN/USERS')).toBe(true);
      expect(isAdminRoute('/Api/V1/Admin/users')).toBe(true);
      expect(isAdminRoute('/api/V1/ADMIN')).toBe(true);
    });
  });

  describe('isWorkerRoute', () => {
    it('matches the worker namespace and its children', () => {
      expect(isWorkerRoute('/worker')).toBe(true);
      expect(isWorkerRoute('/worker/assets')).toBe(true);
      expect(isWorkerRoute('/worker/assets/123')).toBe(true);
    });

    it('ignores the case of the path', () => {
      expect(isWorkerRoute('/WORKER/ASSETS')).toBe(true);
      expect(isWorkerRoute('/Worker/assets')).toBe(true);
    });

    it('does not match the user-facing asset routes', () => {
      expect(isWorkerRoute('/api/v1/assets')).toBe(false);
      expect(isWorkerRoute('/api/v1/admin/users/123')).toBe(false);
    });
  });

  describe('isOpenRoute', () => {
    it('matches the public surfaces', () => {
      expect(isOpenRoute('/health')).toBe(true);
      expect(isOpenRoute('/docs')).toBe(true);
      expect(isOpenRoute('/api/v1/auth')).toBe(true);
      expect(isOpenRoute('/api/v1/auth/login')).toBe(true);
      expect(isOpenRoute('/api/share')).toBe(true);
      expect(isOpenRoute('/api/share/abc123')).toBe(true);
    });

    it('ignores the case of the path', () => {
      expect(isOpenRoute('/HEALTH')).toBe(true);
      expect(isOpenRoute('/DOCS')).toBe(true);
      expect(isOpenRoute('/API/V1/AUTH/LOGIN')).toBe(true);
      expect(isOpenRoute('/Api/V1/Auth/login')).toBe(true);
      expect(isOpenRoute('/API/SHARE/abc123')).toBe(true);
    });

    it('does not open the guarded surfaces', () => {
      expect(isOpenRoute('/api/v1/admin/users')).toBe(false);
      expect(isOpenRoute('/api/v1/assets')).toBe(false);
      expect(isOpenRoute('/worker/assets')).toBe(false);
      expect(isOpenRoute('/')).toBe(false);
    });
  });
});
