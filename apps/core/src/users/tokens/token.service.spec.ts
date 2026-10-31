import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

const jwt = new JwtService({ secret: 'test-secret-0123456789abcdef0123456789' });
const service = new TokenService(jwt);

describe('TokenService.expiresInSeconds', () => {
  it('derives seconds until exp from the token own claim', () => {
    const token = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' }, { expiresIn: 60 });
    const seconds = service.expiresInSeconds(token);
    expect(seconds).toBeGreaterThan(58);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it('returns 0 for a token without exp and for garbage', () => {
    const noExp = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' });
    expect(service.expiresInSeconds(noExp)).toBe(0);
    expect(service.expiresInSeconds('not-a-token')).toBe(0);
  });
});
