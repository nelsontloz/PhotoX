import { parseArgs, validateInput } from './admin-create-args';

describe('admin-create arg parsing/validation', () => {
  it('parses --key=value and --key value flags', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--email=a@b.c'])).toEqual({ email: 'a@b.c' });
    expect(parseArgs(['--email', 'a@b.c', '--password', 'secret-password'])).toEqual({
      email: 'a@b.c',
      password: 'secret-password',
    });
    expect(parseArgs(['--unknown=x'])).toEqual({});
  });

  it('accepts a valid email/password pair', () => {
    expect(validateInput('admin@example.com', 'password123')).toBeNull();
  });

  it('rejects malformed emails', () => {
    for (const bad of ['nope', 'a@b', '@b.c', 'a b@c.d', '']) {
      expect(validateInput(bad, 'password123')).toMatch(/invalid email/);
    }
  });

  it('rejects passwords outside the 8..128 registration bounds', () => {
    expect(validateInput('a@b.c', 'short')).toMatch(/8\.\.128/);
    expect(validateInput('a@b.c', 'x'.repeat(129))).toMatch(/8\.\.128/);
    expect(validateInput('a@b.c', 'x'.repeat(8))).toBeNull();
    expect(validateInput('a@b.c', 'x'.repeat(128))).toBeNull();
  });
});
