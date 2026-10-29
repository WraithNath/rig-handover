// Plan morning-digest § 1. Reads runs/<night>.jsonl into one DigestRow per job.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// Parses one line of the log. Returns null for anything that is not a valid RunLine.
function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (!isStatus(o.status)) return null;
  if (o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const line: RunLine = { at: o.at, job: o.job, status: o.status, owner: o.owner };
  if (o.error !== undefined) line.error = o.error;
  return line;
}

// Reads and parses the night's file. null when it does not exist.
function readLines(runsDir: string, night: string): { lines: RunLine[]; badLines: number } | null {
  const file = join(runsDir, `${night}.jsonl`);
  if (!existsSync(file)) return null;
  const lines: RunLine[] = [];
  let badLines = 0;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line) lines.push(line);
    else badLines++;
  }
  return { lines, badLines };
}

// Compares by instant (offsets respected); the strings themselves are never rewritten.
function instant(line: RunLine): number {
  return Date.parse(line.at);
}

function toRow(job: string, lines: RunLine[]): DigestRow {
  // Stable sort: equal instants keep file order, so the later line in the file wins.
  const ordered = [...lines].sort((a, b) => instant(a) - instant(b));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  let lastError: string | null = null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const error = ordered[i]!.error;
    if (error !== undefined) {
      lastError = error;
      break;
    }
  }
  return {
    job,
    owner: last.owner,
    runs: ordered.length,
    retries: ordered.filter((l) => l.status === 'retry').length,
    lastStatus: last.status,
    lastError,
    firstAt: first.at,
    lastAt: last.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  const read = readLines(runsDir, night);
  if (!read) return null;
  const byJob = new Map<string, RunLine[]>();
  for (const line of read.lines) {
    const list = byJob.get(line.job);
    if (list) list.push(line);
    else byJob.set(line.job, [line]);
  }
  const rows = [...byJob.entries()]
    .map(([job, lines]) => toRow(job, lines))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const result: Night = { night, rows, badLines: read.badLines };
  return result;
};

// Line counts by status for the board (§ 2c). null when the night has no file.
export function countStatuses(
  runsDir: string,
  night: string,
): { ok: number; retry: number; fail: number } | null {
  const read = readLines(runsDir, night);
  if (!read) return null;
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const line of read.lines) counts[line.status]++;
  return counts;
}
