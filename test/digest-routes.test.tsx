import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

const line = (o: Record<string, unknown>) => JSON.stringify(o);

// Jobs are written out of order on purpose: the digest must sort by job.
const normal = [
  line({ at: '2026-01-10T01:00:00+01:00', job: 'zeta-sync', status: 'ok', owner: 'ana' }),
  line({ at: '2026-01-10T01:05:00+01:00', job: 'alpha-backup', status: 'retry', owner: null }),
  line({ at: '2026-01-10T01:10:00+01:00', job: 'alpha-backup', status: 'ok', owner: null }),
  line({ at: '2026-01-10T01:15:00+01:00', job: 'mid-report', status: 'fail', owner: 'ben', error: 'disk full' }),
].join('\n') + '\n';

const withBadLine = [
  line({ at: '2026-01-12T01:00:00+01:00', job: 'beta', status: 'ok', owner: 'ana' }),
  'this is not json {',
  line({ at: '2026-01-12T01:05:00+01:00', job: 'alpha', status: 'ok', owner: 'ben' }),
].join('\n') + '\n';

let tmp: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-digest-'));
  fs.writeFileSync(path.join(tmp, '2026-01-10.jsonl'), normal);
  fs.writeFileSync(path.join(tmp, '2026-01-11.jsonl'), '');
  fs.writeFileSync(path.join(tmp, '2026-01-12.jsonl'), withBadLine);
  app = createApp({ ...config, runsDir: tmp });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

type DigestJson = { night: string; rows: DigestRow[]; badLines: number };

describe('GET /digest/:night', () => {
  it('renders a normal night as a table of its jobs', async () => {
    const res = await app.request('/digest/2026-01-10');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of ['alpha-backup', 'mid-report', 'zeta-sync']) expect(html).toContain(job);
  });

  it('renders a null owner as a dash', async () => {
    const html = await (await app.request('/digest/2026-01-10')).text();
    expect(html).toContain('—');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request('/digest/2025-12-31');
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request('/digest/2026-01-11');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('counts a bad line instead of failing', async () => {
    const res = await app.request('/digest/2026-01-12');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line did not parse');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns night, rows sorted by job, and badLines', async () => {
    const res = await app.request('/api/digest/2026-01-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-01-10');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha-backup', 'mid-report', 'zeta-sync']);
    const alpha = body.rows[0];
    expect(alpha?.owner).toBeNull();
    expect(alpha?.runs).toBe(2);
    expect(alpha?.retries).toBe(1);
    expect(alpha?.lastStatus).toBe('ok');
    expect(body.rows[1]?.lastError).toBe('disk full');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request('/api/digest/2025-12-31');
    expect(res.status).toBe(404);
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request('/api/digest/2026-01-11');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-01-11', rows: [], badLines: 0 });
  });

  it('reports the bad line count and keeps the good rows', async () => {
    const res = await app.request('/api/digest/2026-01-12');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha', 'beta']);
  });
});

describe('page and JSON agree', () => {
  it('lists jobs in the same order in the HTML as in the JSON', async () => {
    const html = await (await app.request('/digest/2026-01-10')).text();
    const body = (await (await app.request('/api/digest/2026-01-10')).json()) as DigestJson;
    const jobs = body.rows.map((r) => r.job);
    const positions = jobs.map((j) => html.indexOf(j));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
