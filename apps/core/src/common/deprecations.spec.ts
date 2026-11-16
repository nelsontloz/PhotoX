import { DEPRECATIONS, deprecationFor } from './deprecations';

describe('deprecationFor', () => {
  it('matches the registered method and path', () => {
    expect(deprecationFor('POST', '/api/v1/assets/bulk-trash')?.path).toBe(
      '/api/v1/assets/bulk-trash',
    );
    expect(deprecationFor('post', '/api/v1/assets/bulk-trash')?.method).toBe('POST');
  });

  it('matches path params but not extra or missing segments', () => {
    expect(deprecationFor('GET', '/api/v1/assets/a1b2/content/download')).toBeDefined();
    expect(deprecationFor('GET', '/api/v1/assets/a1b2/content/download/extra')).toBeUndefined();
    expect(deprecationFor('GET', '/api/v1/assets/content/download')).toBeUndefined();
  });

  it('is case-insensitive like the router', () => {
    expect(deprecationFor('POST', '/API/V1/ASSETS/BULK-TRASH')).toBeDefined();
  });

  it('does not match a different method on the same path', () => {
    expect(deprecationFor('DELETE', '/api/v1/assets/bulk-trash')).toBeUndefined();
    expect(deprecationFor('GET', '/api/v1/assets')).toBeUndefined();
  });
});

describe('DEPRECATIONS', () => {
  it('gives every entry a replacement and a future sunset', () => {
    for (const deprecation of DEPRECATIONS) {
      expect(deprecation.replacement, `${deprecation.method} ${deprecation.path}`).toBeDefined();
      expect(new Date(deprecation.sunset).getTime()).toBeGreaterThan(Date.now());
      expect(deprecation.path.startsWith('/')).toBe(true);
    }
  });

  it('never points a replacement at another deprecated path', () => {
    const deprecated = new Set(DEPRECATIONS.map((d) => `${d.method} ${d.path}`));
    for (const deprecation of DEPRECATIONS) {
      const { method, path } = deprecation.replacement!;
      expect(deprecated.has(`${method} ${path}`)).toBe(false);
    }
  });
});
