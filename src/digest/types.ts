// Plan morning-digest § 1. The contract every part of § 2 builds against: one row per job for
// one night of runs/<night>.jsonl.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One parsed line of the run log.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export type DigestRow = {
  job: string;
  // null in the log stays null here; views render it as `—`.
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Error of the last line that carried one, or null.
  lastError: string | null;
  // `at` as written in the log, offset kept (styleguide: never convert to UTC).
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Sorted by job.
  rows: DigestRow[];
  // Lines that did not parse. Counted, never thrown.
  badLines: number;
};

// Returns null when runs/<night>.jsonl does not exist (routes answer 404).
// An empty file returns { rows: [], badLines: 0 }.
export type ReadNight = (runsDir: string, night: string) => Night | null;
