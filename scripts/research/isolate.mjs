import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { BOUNDS } from './cases.mjs';

// One task at a time; every path waits for termination before resolving.
export function runIsolated(workerUrl, data, { deadline = performance.now() + BOUNDS.totalTimeoutMs,
  timeoutMs = BOUNDS.caseTimeoutMs } = {}) {
  const started = performance.now();
  if (started >= deadline) return Promise.resolve({ status: 'total-timeout', wallMs: 0 });
  return new Promise(resolve => {
    let settled = false, caseTimer;
    const worker = new Worker(workerUrl, {
      workerData: data, resourceLimits: BOUNDS.resourceLimits, execArgv: [], env: {},
    });
    const totalTimer = setTimeout(() => finish({ status: 'total-timeout' }), deadline - started);
    const startupTimer = setTimeout(() => finish({ status: 'startup-timeout' }), BOUNDS.startupTimeoutMs);
    async function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(startupTimer);
      clearTimeout(caseTimer);
      await worker.terminate();
      resolve({ ...result, wallMs: performance.now() - started });
    }
    worker.on('message', message => {
      if (settled) return;
      if (message.type === 'ready') {
        clearTimeout(startupTimer);
        caseTimer = setTimeout(() => finish({ status: 'case-timeout', timeoutMs }), timeoutMs);
        worker.postMessage('run');
      } else if (message.type === 'result') finish(message.result);
    });
    worker.on('error', error => finish({ status: 'worker-error', code: error.code ?? 'WORKER_ERROR' }));
    worker.on('exit', code => finish({ status: 'worker-exit', code }));
  });
}
