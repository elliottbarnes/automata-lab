// A fixed corpus: no arbitrary user pattern, input, or repetition count from the CLI.
export const CASES = Object.freeze([
  ...[8, 12, 16, 20, 24, 28, 32].flatMap(n => ['native', 'dfa'].map(mode => ({
    id: `nested-plus-${n}-${mode}`, family: 'nested-plus', mode, parameter: n,
    pattern: '(a+)+', input: 'a'.repeat(n) + '!',
  }))),
  ...[32, 128, 256, 512].map(n => ({
    id: `dfa-input-${n}`, family: 'dfa-input', mode: 'dfa', parameter: n,
    pattern: '(a+)+', input: 'a'.repeat(n - 1) + '!',
  })),
  ...[0, 2, 4, 5, 6, 7, 8].map(n => ({
    id: `suffix-memory-${n}`, family: 'suffix-memory', mode: 'compile', parameter: n,
    pattern: '(a|b)*a' + '(a|b)'.repeat(n),
  })),
  ...[16, 32, 48, 64, 80, 100, 120].map(n => ({
    id: `optional-chain-${n}`, family: 'optional-chain', mode: 'compile', parameter: n,
    pattern: 'a?'.repeat(n),
  })),
  ...[32, 64, 96, 120, 126].map(n => ({
    id: `optional-alphabet-${n}`, family: 'optional-alphabet', mode: 'compile', parameter: n,
    pattern: Array.from({ length: n }, (_, i) => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 62] + '?').join(''),
  })),
  ...[32, 64, 96, 120, 126, 127].map(n => ({
    id: `literal-chain-${n}`, family: 'literal-chain', mode: 'compile', parameter: n,
    pattern: 'a'.repeat(n),
  })),
].map(Object.freeze));

export const BOUNDS = Object.freeze({
  caseTimeoutMs: 1000,
  nativeTimeoutMs: 250,
  startupTimeoutMs: 3000,
  totalTimeoutMs: 60_000,
  resourceLimits: Object.freeze({
    maxOldGenerationSizeMb: 64,
    maxYoungGenerationSizeMb: 8,
    codeRangeSizeMb: 8,
    stackSizeMb: 2,
  }),
});
