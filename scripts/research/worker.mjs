import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { compile, trace } from '../../docs/engine.js';

parentPort.once('message', () => {
  const { mode, pattern, input } = workerData;
  const started = performance.now();
  let stage = 'compile';
  try {
    if (mode === 'native') {
      const expression = new RegExp(`^(?:${pattern})$`);
      const compileMs = performance.now() - started;
      stage = 'match';
      const matchStarted = performance.now();
      const accepted = expression.test(input);
      parentPort.postMessage({ type: 'result', result: {
        status: 'ok', accepted, compileMs, matchMs: performance.now() - matchStarted,
      } });
      return;
    }
    const compiled = compile(pattern);
    const result = {
      status: 'ok', compileMs: performance.now() - started, operations: compiled.operations,
      nfaStates: compiled.nfa.states.length, dfaStates: compiled.dfa.states.length,
      minStates: compiled.min.states.length, refinementRounds: compiled.min.rounds,
    };
    if (mode === 'dfa') {
      stage = 'match';
      const matchStarted = performance.now();
      const run = trace(compiled.min, input);
      result.matchMs = performance.now() - matchStarted;
      result.accepted = run.accepted;
      // Count observed transition-table reads, outside the timing measurement.
      // This counts deterministic transitions, not all validation/allocation work.
      let transitionReads = 0;
      const counted = { ...compiled.min, states: compiled.min.states.map(state => ({
        ...state, transitions: new Proxy(state.transitions, {
          get(target, property) { transitionReads++; return target[property]; },
        }),
      })) };
      const countedRun = trace(counted, input);
      if (countedRun.accepted !== run.accepted || transitionReads !== input.length) {
        throw new Error('Unexpected deterministic trace instrumentation result');
      }
      result.transitionReads = transitionReads;
      result.frames = run.frames.length;
    }
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({ type: 'result', result: {
      status: error.name === 'CompileError' ? 'compiler-rejection' : 'unexpected-error',
      stage, error: error.message, elapsedMs: performance.now() - started,
    } });
  }
});
parentPort.postMessage({ type: 'ready' });
