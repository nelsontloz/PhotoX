import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { UserBackupService } from '../../src/backup/user-backup.service';
import { S3BackupService } from '../../src/backup/s3-backup.service';
import { hashPassword } from '../../src/users/password';
import { apiServer, closeTestApp, createApiTestApp, resetDb, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';
import type { User } from '../../src/users/entities/user.entity';

const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'new-password-456';

interface BackupSyncBody {
  synced: boolean;
  moved: boolean;
  from?: string;
  to: string;
  reason?: 'no-backup';
  error?: string;
}

interface UpdateUserBody {
  user: {
    id: string;
    displayName: string;
    email: string;
    role: 'user' | 'admin';
    createdAt: string;
    updatedAt: string;
  };
  backup: BackupSyncBody;
}

// The core integration app has no S3 service: UserBackupService is replaced wholesale
// (never constructed, so no S3 call ever happens) and S3BackupService too — its
// onModuleInit HEADs the bucket over the network. moveBackupPrefix is a spy so specs
// can force moved/synced outcomes and inspect what the endpoint passed it.
const moveBackupPrefix =
  vi.fn<(user: Pick<User, 'id' | 'email' | 'displayName' | 'role'>) => Promise<BackupSyncBody>>();
const backupStub = { moveBackupPrefix };

function adminHeader(t: ApiTestApp, admin: User): Record<string, string> {
  return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }));
}

function patchUser(
  t: ApiTestApp,
  id: string,
  auth: Record<string, string>,
  body: Record<string, unknown>,
) {
  return request(apiServer(t)).patch(`/api/v1/admin/users/${id}`).set(auth).send(body);
}

function login(t: ApiTestApp, email: string, password: string) {
  return request(apiServer(t)).post('/api/v1/auth/login').send({ email, password });
}

/** Seed with a real argon2 hash so login specs can authenticate the account. */
async function seedLoginUser(t: ApiTestApp): Promise<User> {
  const user = await seedUser(t);
  user.passwordHash = await hashPassword(OLD_PASSWORD);
  return t.userRepo.save(user);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The guard's session floor is second-granularity (JWT iat is seconds, tokensValidAfter
 * is ms: `floor(floor/1000) > iat`), so a revoke landing in the same second as the
 * token's issue time would leave that token valid. Wait a full second before revoking.
 */
function waitForSessionFloor(): Promise<void> {
  return sleep(1100);
}

describe('admin user edit (PATCH /api/v1/admin/users/:id)', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({
      mockUser: null,
      overrides: [
        { token: UserBackupService, value: backupStub },
        { token: S3BackupService, value: {} },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    moveBackupPrefix.mockReset();
    // default: the prefix already matches the current email (nothing to relocate)
    moveBackupPrefix.mockImplementation((user) =>
      Promise.resolve({
        synced: true,
        moved: false,
        to: `backups/${user.email}__${user.id}/`,
      }),
    );
    await resetDb(t);
  });

  it('404s when the target user does not exist', async () => {
    const admin = await seedUser(t, { role: 'admin' });

    const res = await patchUser(t, randomUUID(), adminHeader(t, admin), { displayName: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('403s when the caller is not an admin', async () => {
    const user = await seedUser(t);
    const target = await seedUser(t);
    const userAuth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));

    const res = await patchUser(t, target.id, userAuth, { displayName: 'Nope' });

    expect(res.status).toBe(403);
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).displayName).toBe('Test User');
  });

  it('403s on a worker act token — no admin route is worker-reachable', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);
    const actAuth = t.authHeader(
      t.signWorkerToken({ id: admin.id, email: admin.email, role: admin.role }, { act: true }),
    );

    const res = await patchUser(t, target.id, actAuth, { displayName: 'Worker Edit' });

    expect(res.status).toBe(403);
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).displayName).toBe('Test User');
  });

  it('400s on a malformed user id', async () => {
    const admin = await seedUser(t, { role: 'admin' });

    const res = await patchUser(t, 'not-a-uuid', adminHeader(t, admin), { displayName: 'X' });

    expect(res.status).toBe(400);
  });

  it('400s on an undeclared body field — role escalation cannot ride this endpoint', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);

    const res = await patchUser(t, target.id, adminHeader(t, admin), { role: 'admin' });

    expect(res.status).toBe(400);
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).role).toBe('user');
  });

  it('400s on a patch that changes nothing', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);

    const res = await patchUser(t, target.id, adminHeader(t, admin), {
      displayName: target.displayName,
    });

    expect(res.status).toBe(400);
    expect(moveBackupPrefix).not.toHaveBeenCalled();
  });

  it('409s when the new email belongs to another account, leaving the target unchanged', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);
    const other = await seedUser(t);

    const res = await patchUser(t, target.id, adminHeader(t, admin), { email: other.email });

    expect(res.status).toBe(409);
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).email).toBe(target.email);
    expect(moveBackupPrefix).not.toHaveBeenCalled();
  });

  it('applies a displayName change, bumps updatedAt, and syncs the backup', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);
    await sleep(10);

    const res = await patchUser(t, target.id, adminHeader(t, admin), {
      displayName: 'Ada Lovelace',
    });

    expect(res.status).toBe(200);
    const body = res.body as UpdateUserBody;
    expect(body.user).toMatchObject({
      id: target.id,
      displayName: 'Ada Lovelace',
      email: target.email,
      role: 'user',
    });
    expect(new Date(body.user.updatedAt).getTime()).toBeGreaterThan(target.updatedAt.getTime());
    expect(body.backup).toEqual({
      synced: true,
      moved: false,
      to: `backups/${target.email}__${target.id}/`,
    });

    expect(await t.userRepo.findOneByOrFail({ id: target.id })).toMatchObject({
      displayName: 'Ada Lovelace',
      email: target.email,
    });
    expect(moveBackupPrefix).toHaveBeenCalledTimes(1);
    expect(moveBackupPrefix.mock.calls[0]![0]).toMatchObject({
      id: target.id,
      displayName: 'Ada Lovelace',
      email: target.email,
    });
    // a displayName-only change never revokes sessions
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).tokensValidAfter).toBeNull();
  });

  it('normalizes an email change, revokes sessions, and moves the backup prefix', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedLoginUser(t);
    const accessToken = t.signToken({ id: target.id, email: target.email, role: target.role });
    await waitForSessionFloor();

    const res = await patchUser(t, target.id, adminHeader(t, admin), {
      email: '  MiXeD@Example.COM  ',
    });

    expect(res.status).toBe(200);
    const body = res.body as UpdateUserBody;
    expect(body.user.email).toBe('mixed@example.com');
    expect(body.backup).toEqual({
      synced: true,
      moved: false,
      to: `backups/mixed@example.com__${target.id}/`,
    });
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).email).toBe('mixed@example.com');
    expect(moveBackupPrefix.mock.calls[0]![0]).toMatchObject({
      id: target.id,
      email: 'mixed@example.com',
    });

    // the pre-edit access token is dead (revoked refresh tokens + tokensValidAfter floor)
    const revoked = await request(apiServer(t))
      .get('/api/v1/albums')
      .set(t.authHeader(accessToken));
    expect(revoked.status).toBe(401);

    const newLogin = await login(t, 'mixed@example.com', OLD_PASSWORD);
    expect(newLogin.status).toBe(200);
    expect((newLogin.body as { user: { id: string } }).user.id).toBe(target.id);

    const oldLogin = await login(t, target.email, OLD_PASSWORD);
    expect(oldLogin.status).toBe(401);
  }, 120_000);

  it('applies a password change, keeps the account id, and kills old credentials', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedLoginUser(t);
    const accessToken = t.signToken({ id: target.id, email: target.email, role: target.role });
    await waitForSessionFloor();

    const res = await patchUser(t, target.id, adminHeader(t, admin), { password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((res.body as UpdateUserBody).user.id).toBe(target.id);

    const newLogin = await login(t, target.email, NEW_PASSWORD);
    expect(newLogin.status).toBe(200);
    expect((newLogin.body as { user: { id: string } }).user.id).toBe(target.id);

    const oldLogin = await login(t, target.email, OLD_PASSWORD);
    expect(oldLogin.status).toBe(401);

    const revoked = await request(apiServer(t))
      .get('/api/v1/albums')
      .set(t.authHeader(accessToken));
    expect(revoked.status).toBe(401);
  }, 120_000);

  it('does not revoke sessions on a displayName-only change', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);
    const accessToken = t.signToken({ id: target.id, email: target.email, role: target.role });

    const res = await patchUser(t, target.id, adminHeader(t, admin), { displayName: 'Renamed' });

    expect(res.status).toBe(200);

    const stillValid = await request(apiServer(t))
      .get('/api/v1/albums')
      .set(t.authHeader(accessToken));
    expect(stillValid.status).toBe(200);
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).tokensValidAfter).toBeNull();
  });

  it('still succeeds when the backup move fails, reporting backup.synced=false', async () => {
    const admin = await seedUser(t, { role: 'admin' });
    const target = await seedUser(t);
    moveBackupPrefix.mockResolvedValueOnce({
      synced: false,
      moved: false,
      to: `backups/${target.email}__${target.id}/`,
      error: 'S3 unreachable',
    });

    const res = await patchUser(t, target.id, adminHeader(t, admin), {
      displayName: 'Applied Anyway',
    });

    expect(res.status).toBe(200);
    const body = res.body as UpdateUserBody;
    expect(body.user.displayName).toBe('Applied Anyway');
    expect(body.backup.synced).toBe(false);
    expect(body.backup.error).toBe('S3 unreachable');
    // the edit itself is persisted even though the prefix could not be relocated
    expect((await t.userRepo.findOneByOrFail({ id: target.id })).displayName).toBe(
      'Applied Anyway',
    );
  });
});
