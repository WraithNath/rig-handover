import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countStatuses, readNight } from '../src/digest/reader.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs, sorted, with 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.badLines).toBe(1);
    const jobs = night!.rows.map((r) => r.job);
    expect(jobs).toHaveLength(5);
    expect(jobs).toEqual([...jobs].sort());
  });

  it('folds fixtures/refresh into one row', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps digest/render with a null owner', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toBeDefined();
    expect(row!.owner).toBeNull();
  });

  it('counts lines by status', () => {
    expect(countStatuses('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', () => {
    expect(readNight(dir, '1999-01-01')).toBeNull();
    expect(countStatuses(dir, '1999-01-01')).toBeNull();
  });

  it('returns no rows for an empty file', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
    expect(countStatuses(dir, '2026-01-01')).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('counts bad lines without throwing', () => {
    const lines = [
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"fail","owner":"x","error":"boom"}',
      'not json',
      '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-02T02:00:00+01:00","status":"ok","owner":"x"}',
      '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"ok","owner":7}',
      '[1,2]',
      '{"at":"2026-01-02T03:00:00+01:00","job":"a","status":"ok","owner":"x"}',
    ];
    writeFileSync(join(dir, '2026-01-02.jsonl'), lines.join('\n') + '\n');
    const night = readNight(dir, '2026-01-02');
    expect(night!.badLines).toBe(5);
    expect(night!.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 2,
        retries: 0,
        lastStatus: 'ok',
        lastError: 'boom',
        firstAt: '2026-01-02T01:00:00+01:00',
        lastAt: '2026-01-02T03:00:00+01:00',
      },
    ]);
  });
});
