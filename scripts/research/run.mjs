import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { LIMITS } from '../../docs/engine.js';
import { CASES, BOUNDS } from './cases.mjs';
import { runIsolated } from './isolate.mjs';

if (process.execArgv.length || process.env.NODE_OPTIONS || process.argv.length !== 2) {
  throw new Error('Run without Node flags, NODE_OPTIONS, or arguments; the corpus and budgets are fixed.');
}
const started = performance.now(), deadline = started + BOUNDS.totalTimeoutMs;
const files = ['../../docs/engine.js', './cases.mjs', './worker.mjs', './isolate.mjs', './run.mjs'];
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
  createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])));
const results = [];
for (const item of CASES) {
  const result = await runIsolated(new URL('./worker.mjs', import.meta.url), item, {
    deadline, timeoutMs: item.mode === 'native' ? BOUNDS.nativeTimeoutMs : BOUNDS.caseTimeoutMs,
  });
  results.push({ ...item, ...result });
  if (result.status === 'total-timeout') break;
}
const report = {
  schemaVersion: 1, capturedAt: new Date().toISOString(),
  runtime: { node: process.version, v8: process.versions.v8, platform: process.platform,
    osRelease: release(), architecture: process.arch, cpuModel: cpus()[0]?.model,
    logicalCpus: cpus().length, memoryGiB: totalmem() / 2 ** 30,
    nodeFlags: [], nodeOptions: '',
  },
  bounds: BOUNDS, engineLimits: LIMITS, hashes, plannedCases: CASES.length,
  completedCases: results.length, totalWallMs: performance.now() - started, results,
};
console.log(JSON.stringify(report, null, 2));
if (results.some(row => ['unexpected-error', 'worker-error', 'worker-exit', 'startup-timeout', 'total-timeout'].includes(row.status)
  || (row.status === 'case-timeout' && row.mode !== 'native')
  || (row.mode !== 'compile' && row.status === 'ok' && row.accepted !== false))) {
  process.exitCode = 1;
}
