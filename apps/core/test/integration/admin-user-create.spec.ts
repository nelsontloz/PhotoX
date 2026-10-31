import request from 'supertest';
import { S3BackupService } from '../../src/backup/s3-backup.service';
import { BullMqService } from '../../src/queue/bullmq.service';
import { hashPassword } from '../../src/users/password';
import { apiServer, closeTestApp, createApiTestApp, resetDb, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';
import type { User } from '../../src/users/entities/user.entity';

const ADMIN_PASSWORD = 'admin-password-123';
const PASSWORD = 'correcthorsebattery';
const NEW_PASSWORD = 'new-password-456';

interface AdminUserRowBody {
  id: string;
  displayName: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
}

/** Seed with a real argon2 hash so the admin can log in and drive the real guard. */
async function seedLoginUser(t: ApiTestApp, role: 'user' | 'admin' = 'admin'): Promise<User> {
  const user = await seedUser(t, { role });
  user.passwordHash = await hashPassword(ADMIN_PASSWORD);
  return t.userRepo.save(user);
}

function login(t: ApiTestApp, email: string, password: string) {
  return request(apiServer(t)).post('/api/v1/auth/login').send({ email, password });
}

async function loginHeader(t: ApiTestApp, user: User): Promise<Record<string, string>> {
  const res = await login(t, user.email, ADMIN_PASSWORD);
  return t.authHeader((res.body as { accessToken: string }).accessToken);
}

function createUser(
  t: ApiTestApp,
  auth: Record<string, string> | null,
  body: Record<string, unknown>,
) {
  const req = request(apiServer(t));
  const post = req.post('/api/v1/admin/users');
  return auth ? post.set(auth).send(body) : post.send(body);
}

function register(t: ApiTestApp, email: string) {
  return request(apiServer(t))
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, displayName: 'Public User' });
}

describe('admin user creation (POST /api/v1/admin/users)', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    // S3BackupService's boot probe HEADs the bucket over the network — never constructed here
    t = await createApiTestApp({
      mockUser: null,
      overrides: [{ token: S3BackupService, value: {} }],
    });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
    // this app's dedicated Redis only; clear fixed-window counters so tests stay independent
    await t.app.get<BullMqService>(BullMqService).redis.flushdb();
  });

  it('creates a user (201, list-row shape) and the account can log in', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);

    const res = await createUser(t, auth, {
      email: '  New.User@Example.COM  ',
      password: NEW_PASSWORD,
      displayName: '  Ada Lovelace  ',
    });

    expect(res.status).toBe(201);
    const body = res.body as AdminUserRowBody;
    // the same row shape listUsers returns — exactly these five fields
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'role']);
    expect(body.displayName).toBe('Ada Lovelace');
    expect(body.email).toBe('new.user@example.com');
    expect(body.role).toBe('user');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);

    const stored = await t.userRepo.findOneByOrFail({ id: body.id });
    expect(stored.email).toBe('new.user@example.com');
    // stored hashed, never the submitted plaintext
    expect(stored.passwordHash).not.toBe(NEW_PASSWORD);

    const loggedIn = await login(t, 'new.user@example.com', NEW_PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect((loggedIn.body as { user: { id: string } }).user.id).toBe(body.id);
  });

  it('creates an admin when the role is requested', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);

    const res = await createUser(t, auth, {
      email: 'second-admin@example.com',
      password: NEW_PASSWORD,
      displayName: 'Second Admin',
      role: 'admin',
    });

    expect(res.status).toBe(201);
    expect((res.body as AdminUserRowBody).role).toBe('admin');
  });

  it('409s when an admin address collides with a raw mixed-case registration', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);
    // open registration stores the address raw; admin creation stores it normalized
    expect((await register(t, 'Public.User@Example.com')).status).toBe(201);
    const before = await t.userRepo.count();

    for (const email of ['public.user@example.com', 'PUBLIC.USER@EXAMPLE.COM']) {
      const res = await createUser(t, auth, {
        email,
        password: NEW_PASSWORD,
        displayName: 'Dup',
      });
      expect(res.status).toBe(409);
    }

    expect(await t.userRepo.count()).toBe(before);
    expect(await t.userRepo.findOneBy({ email: 'public.user@example.com' })).toBeNull();
    expect(await t.userRepo.findOneBy({ email: 'Public.User@Example.com' })).not.toBeNull();
  });

  it('409s on a duplicate email regardless of casing', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);
    await seedUser(t, { email: 'taken@example.com' });

    const res = await createUser(t, auth, {
      email: 'TAKEN@example.com',
      password: NEW_PASSWORD,
      displayName: 'Dup',
    });

    expect(res.status).toBe(409);
    expect(await t.userRepo.findOneBy({ email: 'TAKEN@example.com' })).toBeNull();
  });

  it('409s when public sign-up reuses an admin-created address in another casing', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);

    const created = await createUser(t, auth, {
      email: 'shared@example.com',
      password: NEW_PASSWORD,
      displayName: 'Shared',
    });
    expect(created.status).toBe(201);

    // open sign-up stores the address raw but must not mint a second account on the same
    // normalized identity (the admin row is stored lowercase)
    expect((await register(t, 'Shared@Example.com')).status).toBe(409);
    expect(await t.userRepo.count()).toBe(2);
  });

  it('403s when the caller is not an admin', async () => {
    const user = await seedUser(t);
    const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));

    const res = await createUser(t, auth, {
      email: 'nope@example.com',
      password: NEW_PASSWORD,
      displayName: 'Nope',
    });

    expect(res.status).toBe(403);
    expect(await t.userRepo.findOneBy({ email: 'nope@example.com' })).toBeNull();
  });

  it('registers no one over HTTP without a token', async () => {
    const res = await createUser(t, null, {
      email: 'anonymous@example.com',
      password: NEW_PASSWORD,
      displayName: 'Anon',
    });

    expect(res.status).toBe(401);
  });

  it('disabling registration blocks public sign-up but not admin creation', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);

    const off = await request(apiServer(t))
      .patch('/api/v1/admin/registration')
      .set(auth)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ enabled: false });

    const settings = await request(apiServer(t)).get('/api/v1/auth/registration');
    expect(settings.status).toBe(200);
    expect(settings.body).toEqual({ enabled: false });

    expect((await register(t, 'public@example.com')).status).toBe(403);

    const created = await createUser(t, auth, {
      email: 'admin-made@example.com',
      password: NEW_PASSWORD,
      displayName: 'Admin Made',
    });
    expect(created.status).toBe(201);
    expect((await login(t, 'admin-made@example.com', NEW_PASSWORD)).status).toBe(200);
  });

  it('re-enabling registration restores public sign-up', async () => {
    const admin = await seedLoginUser(t);
    const auth = await loginHeader(t, admin);

    await request(apiServer(t))
      .patch('/api/v1/admin/registration')
      .set(auth)
      .send({ enabled: false });
    await request(apiServer(t))
      .patch('/api/v1/admin/registration')
      .set(auth)
      .send({ enabled: true });

    const settings = await request(apiServer(t)).get('/api/v1/auth/registration');
    expect(settings.body).toEqual({ enabled: true });
    expect((await register(t, 'back@example.com')).status).toBe(201);
  });
});
