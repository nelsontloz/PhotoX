import { describe, expect, it } from 'vitest';
import {
  backupPrefix,
  encodeSegment,
  findPrefixesForUserId,
  manifestKey,
  normalizeEmail,
  originalKey,
  parseBackupDir,
} from './backup-path';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});

describe('encodeSegment', () => {
  it('encodes spaces and ampersands per segment', () => {
    expect(encodeSegment('a b&c')).toBe('a%20b%26c');
  });
});

describe('backupPrefix', () => {
  it('builds backups/<email>__<userId>/ with the default prefix', () => {
    expect(backupPrefix('Foo@Example.com', 'user-1', 'backups/')).toBe(
      'backups/foo%40example.com__user-1/',
    );
  });

  it('normalizes the prefix idempotently', () => {
    expect(backupPrefix('a@b.c', 'u1', '//backups//')).toBe('backups/a%40b.c__u1/');
  });

  it('throws on empty email or userId', () => {
    expect(() => backupPrefix('', 'u1', 'backups/')).toThrow();
    expect(() => backupPrefix('   ', 'u1', 'backups/')).toThrow();
    expect(() => backupPrefix('a@b.c', '', 'backups/')).toThrow();
    expect(() => backupPrefix('a@b.c', '   ', 'backups/')).toThrow();
  });
});

describe('manifestKey', () => {
  it('appends manifest.json to the prefix', () => {
    expect(manifestKey('a@b.c', 'u1', 'backups/')).toBe('backups/a%40b.c__u1/manifest.json');
  });
});

describe('originalKey', () => {
  it('builds the originals/<fileId>.<ext> key', () => {
    expect(originalKey('a@b.c', 'u1', 'file-1', 'jpg', 'backups/')).toBe(
      'backups/a%40b.c__u1/originals/file-1.jpg',
    );
  });

  it('strips leading dots from the extension', () => {
    expect(originalKey('a@b.c', 'u1', 'file-1', '..JPG', 'backups/')).toBe(
      'backups/a%40b.c__u1/originals/file-1.JPG',
    );
  });

  it('throws on empty fileId', () => {
    expect(() => originalKey('a@b.c', 'u1', '', 'jpg', 'backups/')).toThrow();
  });
});

describe('parseBackupDir', () => {
  it('round-trips backupPrefix through the last-__ split', () => {
    const prefix = backupPrefix('Foo@Example.com', 'user-1', 'backups/');
    const dir = prefix.replace(/^backups\//, '');
    expect(parseBackupDir(dir)).toEqual({ email: 'foo@example.com', userId: 'user-1' });
  });

  it('splits on the LAST __ so emails containing __ survive', () => {
    expect(parseBackupDir('we__ird%40x.com__user-1')).toEqual({
      email: 'we__ird@x.com',
      userId: 'user-1',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseBackupDir('a%40b.c__u1/')).toEqual({ email: 'a@b.c', userId: 'u1' });
  });

  it('throws on a missing separator or empty sides', () => {
    expect(() => parseBackupDir('no-separator')).toThrow();
    expect(() => parseBackupDir('__u1')).toThrow();
    expect(() => parseBackupDir('a%40b.c__')).toThrow();
  });
});

describe('findPrefixesForUserId', () => {
  it('matches a dir whose email contains __ via the last-__ split', () => {
    const base = 'backups/';
    const dir = 'we__ird%40x.com__user-1';
    const keys = [`${base}${dir}/manifest.json`, `${base}${dir}/originals/f1.jpg`];
    expect(findPrefixesForUserId(keys, base, 'user-1')).toEqual([`${base}${dir}/`]);
  });

  it('returns every distinct prefix for one userId across email changes', () => {
    const base = 'backups/';
    const oldDir = 'old%40x.com__user-1';
    const newDir = 'new%40x.com__user-1';
    const keys = [
      `${base}${oldDir}/manifest.json`,
      `${base}${oldDir}/originals/f1.jpg`,
      `${base}${oldDir}/originals/f1.jpg`,
      `${base}${newDir}/manifest.json`,
      `${base}other%40x.com__user-2/manifest.json`,
    ];
    expect(findPrefixesForUserId(keys, base, 'user-1')).toEqual([
      `${base}${oldDir}/`,
      `${base}${newDir}/`,
    ]);
  });

  it('excludes email-reuse dirs (same email, different userId) and non-backup keys', () => {
    const base = 'backups/';
    const keys = [
      'backups/shared%40x.com__user-1/manifest.json',
      'backups/shared%40x.com__user-2/manifest.json',
      'backups/not-a-backup-dir/manifest.json',
      'other-prefix/shared%40x.com__user-1/manifest.json',
      'backups/shared%40x.com__user-1/originals/f1.jpg',
    ];
    expect(findPrefixesForUserId(keys, base, 'user-1')).toEqual([
      'backups/shared%40x.com__user-1/',
    ]);
    expect(findPrefixesForUserId(keys, base, 'user-2')).toEqual([
      'backups/shared%40x.com__user-2/',
    ]);
    expect(findPrefixesForUserId(keys, base, 'ghost')).toEqual([]);
  });
});
