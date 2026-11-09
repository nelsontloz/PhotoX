import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import {
  FACE_DETECTOR_MODEL_FILE,
  loadAuthEnv,
  loadEnv,
  resolveFaceDetectorModelPath,
} from './env';

// `.env.example` is shipped at the workspace root; this spec runs with its package as cwd.
function findExampleEnv(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, '.env.example');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('.env.example not found above ' + process.cwd());
    dir = parent;
  }
}

describe('AUTH_REFRESH_TTL parsing', () => {
  const original = process.env.AUTH_REFRESH_TTL;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_REFRESH_TTL;
    else process.env.AUTH_REFRESH_TTL = original;
  });

  it('parses duration units to milliseconds', () => {
    process.env.AUTH_REFRESH_TTL = '2h';
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(2 * 60 * 60 * 1000);
  });

  it('defaults to 1d when unset', () => {
    delete process.env.AUTH_REFRESH_TTL;
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(1 * 24 * 60 * 60 * 1000);
  });

  it('throws for an unparseable value instead of silently shortening sessions', () => {
    process.env.AUTH_REFRESH_TTL = 'garbage';
    expect(() => loadEnv()).toThrow(/Invalid duration "garbage"/);
  });
});

describe('face detector helpers', () => {
  const originalPath = process.env.FACE_DETECTOR_MODEL_PATH;
  const originalStorageDir = process.env.STORAGE_DIR;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.FACE_DETECTOR_MODEL_PATH;
    else process.env.FACE_DETECTOR_MODEL_PATH = originalPath;
    if (originalStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = originalStorageDir;
  });

  it('resolveFaceDetectorModelPath prefers FACE_DETECTOR_MODEL_PATH', () => {
    process.env.FACE_DETECTOR_MODEL_PATH = '/custom/det.onnx';
    expect(resolveFaceDetectorModelPath()).toBe('/custom/det.onnx');
  });

  it('resolveFaceDetectorModelPath defaults under STORAGE_DIR/models', () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH;
    process.env.STORAGE_DIR = '/tmp/photox-storage-test';
    expect(resolveFaceDetectorModelPath()).toBe(
      join('/tmp/photox-storage-test', 'models', FACE_DETECTOR_MODEL_FILE),
    );
  });
});

// The repo ships `.env.example` and the README says `cp .env.example .env`. Any secret that is
// published in the repo must therefore fail validation, or a default install is forgeable with
// a one-line HS256 token. These pin that the printed values are not deployable.
describe('shipped auth secrets', () => {
  const KEYS = ['AUTH_TOKEN_SECRET', 'AUTH_TOKEN_SECRET_PREVIOUS', 'WORKER_JWT_SECRET'] as const;
  const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  function useExampleSecrets(): void {
    const example = parseEnv(readFileSync(findExampleEnv(), 'utf8'));
    process.env.AUTH_TOKEN_SECRET = example.AUTH_TOKEN_SECRET;
    process.env.WORKER_JWT_SECRET = example.WORKER_JWT_SECRET;
    delete process.env.AUTH_TOKEN_SECRET_PREVIOUS;
  }

  it('rejects the secrets shipped in .env.example', () => {
    useExampleSecrets();
    // the file must actually ship values — an empty assignment would fail validation for the
    // wrong reason and hide a broken template
    expect(process.env.AUTH_TOKEN_SECRET).toBeTruthy();
    expect(process.env.WORKER_JWT_SECRET).toBeTruthy();
    expect(() => loadAuthEnv()).toThrow(/AUTH_TOKEN_SECRET|WORKER_JWT_SECRET/);
  });

  it('rejects a published placeholder that passes the length and variety check', () => {
    process.env.AUTH_TOKEN_SECRET = 'change-me-to-at-least-32-characters-long-string';
    process.env.WORKER_JWT_SECRET = 'change-me-to-a-different-32-characters-long-string';
    delete process.env.AUTH_TOKEN_SECRET_PREVIOUS;
    expect(() => loadAuthEnv()).toThrow(/AUTH_TOKEN_SECRET|WORKER_JWT_SECRET/);
  });
});
