import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CASES, BOUNDS } from '../scripts/research/cases.mjs';
import { runIsolated } from '../scripts/research/isolate.mjs';

const worker = new URL('../scripts/research/worker.mjs', import.meta.url);
const fixture = source => new URL(`data:text/javascript,${encodeURIComponent(source)}`);
const stuck = fixture(`
  import { parentPort } from 'node:worker_threads';
  parentPort.once('message', () => { while (true) {} });
  parentPort.postMessage({ type: 'ready' });
`);

test('real compiler work limit rejects a bounded pattern, then a fresh worker recovers', async () => {
  const below = await runIsolated(worker, CASES.find(x => x.id === 'optional-alphabet-96'));
  assert.equal(below.status, 'ok');
  assert.ok(below.operations < 2_000_000);
  const above = await runIsolated(worker, CASES.find(x => x.id === 'optional-alphabet-120'));
  assert.equal(above.status, 'compiler-rejection');
  assert.match(above.error, /Compilation exceeded .* operations/);
  const recovery = await runIsolated(worker, { mode: 'dfa', pattern: 'a', input: 'a' });
  assert.equal(recovery.status, 'ok');
  assert.equal(recovery.accepted, true);
});

test('isolated DFA trace observes one transition per input symbol at the input limit', async () => {
  const result = await runIsolated(worker, CASES.find(x => x.id === 'dfa-input-512'));
  assert.equal(result.status, 'ok');
  assert.equal(result.accepted, false);
  assert.equal(result.transitionReads, 512);
  assert.equal(result.frames, 513);
});

test('worker watchdog terminates a stalled case and permits subsequent work', async () => {
  const result = await runIsolated(stuck, {}, { timeoutMs: 30 });
  assert.equal(result.status, 'case-timeout');
  const recovery = await runIsolated(worker, { mode: 'compile', pattern: 'a' });
  assert.equal(recovery.status, 'ok');
});

test('whole-run deadline stops a stalled worker and prevents a late launch', async () => {
  const result = await runIsolated(stuck, {}, {
    deadline: performance.now() + 100, timeoutMs: 5000,
  });
  assert.equal(result.status, 'total-timeout');
  const late = await runIsolated(stuck, {}, { deadline: performance.now() - 1 });
  assert.equal(late.status, 'total-timeout');
  assert.equal(late.wallMs, 0);
});

test('worker exit without a result is a failure, not an empty successful sample', async () => {
  const result = await runIsolated(fixture('process.exit(7);'), {});
  assert.equal(result.status, 'worker-exit');
  assert.equal(result.code, 7);
});

test('worker receives explicit JS memory limits and no ambient Node options', async () => {
  const result = await runIsolated(fixture(`
    import { parentPort, resourceLimits } from 'node:worker_threads';
    parentPort.postMessage({ type: 'result', result: {
      status: 'ok', limits: resourceLimits, flags: process.execArgv, options: process.env.NODE_OPTIONS,
    } });
  `), {});
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.limits, BOUNDS.resourceLimits);
  assert.deepEqual(result.flags, []);
  assert.equal(result.options, undefined);
});
