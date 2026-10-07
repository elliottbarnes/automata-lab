# When regex becomes a resource-exhaustion problem

7 October 2026 · [Project overview](../README.md) · [Full compiler guide](../reference/guide.md)

**Matching and compilation need separate budgets.** In this bounded local sample, native regex rejection slowed sharply on nested repetition, while the compiled minimal DFA read exactly one transition per input character. Other patterns reached Automata Lab's existing DFA-state and compilation-work limits. Those rejections were expected behavior; this investigation found no compiler defect in the tested cases and makes no new safety claim for arbitrary input.

## Question and assumptions

What work can an expression or input string force, and where does the lab stop it? Two inputs are potentially adversarial: a pattern being compiled, and a string being matched. The engine is trusted source. Returned machine objects are not a public serialization format and `trace` does not validate machines supplied by an attacker.

The comparison uses the common supported subset: printable ASCII, grouping, repetition, concatenation, and full-string matching. The native form is `new RegExp('^(?:' + pattern + ')$')` with no flags. These inputs contain no newline, so native `$` end-of-line behavior does not change the verdict. There is no network target, visitor-submitted benchmark, or load test here.

The [V8 explanation of backtracking and its experimental alternative](https://v8.dev/blog/non-backtracking-regexp) describes why nested repetitions can be expensive and why runtime configuration matters. [RE2's design goals](https://github.com/google/re2#readme) distinguish linear matching from the separate need to bound compiler and engine memory. RE2 is background reading here; it was not installed or benchmarked.

## Reproduce

From the repository root with Node.js 24 or newer:

```sh
npm test
npm run --silent research > /tmp/automata-results.json
```

The command accepts no extra arguments, Node flags, or `NODE_OPTIONS`. It runs one fixed corpus once, with no warmup, retries, adaptive input growth, or hidden repeats. Every case starts a fresh worker; inputs and patterns are written into the JSON. `cases.mjs` is the authoritative list of 43 cases.

- [Corpus and budgets](../scripts/research/cases.mjs)
- [Worker lifecycle](../scripts/research/isolate.mjs)
- [Measurements](../scripts/research/worker.mjs)
- [Report command](../scripts/research/run.mjs)
- [Captured JSON](results/2026-10-07-node24-darwin-arm64.json)

The sample uses Node **v24.19.0**, V8 **13.6.233.17-node.51**, Darwin **27.0.0**, **arm64**, an **Apple M4**, **10 logical CPUs**, and **16 GiB RAM**, with no Node command-line flags or `NODE_OPTIONS`. It ran 43/43 cases in **1,743.474 ms**: 34 completed, 6 compiler rejections, and 3 native-case timeouts. Runtime and source SHA-256 hashes are in the JSON; no machine name, account name, or local path is collected. The engine is unchanged from `e0faf5ceae6eeb2c8a0cb00b51496976dad9655d`.

These are single observations on one machine, not distributions or throughput benchmarks. The deterministic counts support the algorithm explanation; sub-millisecond timings mostly establish that the sample completed.

## Containment and measurements

| Boundary | Value and behavior |
| --- | --- |
| Native execution window | 250 ms after worker readiness; parent terminates a case that has not returned |
| Other execution window | 1,000 ms after readiness |
| Worker startup | 3,000 ms |
| Whole run | 60,000 ms deadline; no new case launches after expiry |
| Concurrent cases | One; termination is awaited before the next worker starts |
| Worker JavaScript resources | 64 MB old generation, 8 MB young generation, 8 MB code range, 2 MB stack |
| Corpus size | 43 fixed cases; largest tested match input is 512 characters |
| Compiler budgets | Unmodified production `LIMITS`: 256 pattern characters, 512 NFA states, 128 DFA states, 2,000,000 operations |

Timers run in the parent, independently of synchronous worker computation. Deadlines include message scheduling and require the parent event loop and worker termination to make progress; they are not hard real-time guarantees. The total timer applies across startup and execution, while the measured whole-run time also includes cleanup and report preparation.

The JavaScript memory settings are **not a whole-process RAM cap**. Node documents that [Worker resource limits](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options) do not cover external allocations such as ArrayBuffers and cannot prevent global out-of-memory failure. The harness runs trusted code on fixed small strings and creates no large external buffers. It is unsuitable for executing arbitrary untrusted JavaScript.

For completed cases, `compileMs` and `matchMs` use the worker's monotonic clock. Native `compileMs` times only `new RegExp`; lazy compilation or JIT work may occur during `test`. DFA `matchMs` times the existing `trace` API, including input validation and trace-frame allocation, but excludes compilation. Neither timing includes worker startup, messages, or termination. `wallMs` includes those costs.

A second untimed DFA trace wraps transition tables with a read counter. `transitionReads` counts actual table reads, not CPU instructions, validation steps, or allocations. Compiler `operations` is the engine's existing instrumented work counter; it is a different unit. A rejected compilation returns no partial machine or operation count, so its rows omit those fields. A worker timeout is a censored observation, not a measured match duration or a rejection verdict.

## 1. Nested repetition: match cost

Pattern: **`(a+)+`**. Input: **`'a'.repeat(n) + '!'`**. Each completed engine rejects it.

| `n` | Input characters | Native `test` (ms) | Minimal-DFA `trace` (ms) | DFA transition reads |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 9 | 0.019 | 0.061 | 9 |
| 12 | 13 | 0.086 | 0.063 | 13 |
| 16 | 17 | 1.183 | 0.061 | 17 |
| 20 | 21 | 19.952 | 0.064 | 21 |
| 24 | 25 | 250 ms worker window expired | 0.072 | 25 |
| 28 | 29 | 250 ms worker window expired | 0.068 | 29 |
| 32 | 33 | 250 ms worker window expired | 0.069 | 33 |

The native timeouts include the ready-to-result window, not just `test`; no exact native duration is inferred. Each DFA compilation had 6 NFA, 3 DFA, and 3 minimal states, and 996 budgeted operations. The same accepted language can be written as `a+`; nested repetition gives a backtracking implementation many ways to partition the run of `a` characters before encountering the failing `!`.

Additional DFA-only cases use `'a'.repeat(length - 1) + '!'` at lengths 32, 128, 256, and 512. Observed table reads are **32, 128, 256, and 512**, respectively, and retained frame counts are one larger. Observed trace times are 0.076, 0.088, 0.104, and 0.185 ms. This checks the implementation's one-transition-per-character behavior through its supported input limit. It does not measure native-regex operation counts or establish a universal speed ratio.

## 2. Remembering a suffix: state growth

Pattern: **`'(a|b)*a' + '(a|b)'.repeat(k)`**. The expression asks whether the character `k + 1` positions from the end is `a`. The machine must distinguish relevant suffix histories.

| `k` | NFA states | DFA states | Minimal states | Compiler operations | Compile or rejection time (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 10 | 4 | 3 | 1,587 | 0.662 |
| 2 | 22 | 10 | 9 | 6,118 | 1.101 |
| 4 | 34 | 34 | 33 | 27,144 | 2.788 |
| 5 | 40 | 66 | 65 | 59,217 | 4.347 |
| 6 | — | state-limit rejection | — | — | 1.858 |
| 7 | — | state-limit rejection | — | — | 1.870 |
| 8 | — | state-limit rejection | — | — | 2.412 |

At `k = 6`, subset construction attempts to exceed **128 DFA states** and throws `CompileError`. A shorter runtime on rejected rows is expected: compilation stops before finishing the machine and minimization. The bound applies to the intermediate DFA; a pattern that might minimize below a limit can still be rejected during construction.

The completed counts demonstrate rapid state growth for this family. The compiler's state guard, rather than an extrapolated time estimate, bounds the sample. The full [algorithm guide](../reference/guide.md#3-subset-construction) discusses subset construction's worst-case exponential number of states.

## 3. Optional literals: work exhaustion

Let `alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'`. For each `n`, the pattern is generated exactly as:

```js
Array.from({ length: n }, (_, i) => alphabet[i % 62] + '?').join('')
```

This creates many distinguishable symbol classes and overlapping optional suffixes. It can exhaust compiler work without first reaching the pattern or NFA-state limits.

| `n` | Pattern characters | NFA states | DFA states | Compiler operations | Compile or rejection time (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 64 | 128 | 34 | 106,215 | 5.760 |
| 64 | 128 | 256 | 66 | 737,041 | 22.712 |
| 96 | 192 | 384 | 98 | 1,797,281 | 48.541 |
| 120 | 240 | — | — | work-limit rejection | 63.365 |
| 126 | 252 | — | — | work-limit rejection | 55.928 |

The last two throw **“Compilation exceeded 2,000,000 operations.”** The engine rejects on the tick that would go over its work budget; the error does not expose the exact partial operation count or stage. The experiment does not disable limits to estimate the uncapped cost.

Two control families help distinguish pattern length from work. `'a?'.repeat(n)` completes through `n = 120` with 1,535,356 operations. `'a'.repeat(n)` completes through `n = 126` with 128 DFA states and 1,569,706 operations; `n = 127` hits the DFA-state cap. All parameters and counts are in the JSON. Equal source lengths do not imply equal compile work, and modest state counts do not make a work budget redundant.

## Regression evidence

The existing 22 engine tests remain intact. Six new tests bring the suite to **28 passing tests**:

1. A real optional-alphabet pattern completes below the work budget, a larger one rejects, and a fresh worker then successfully compiles and matches `a`.
2. The 512-character DFA trace rejects the selected input with 512 observed transition reads and 513 frames.
3. A deliberately stalled worker is terminated at its case timeout; later compilation succeeds.
4. The whole-run deadline terminates stalled work and prevents a launch after expiry.
5. A worker that exits without a result is classified as a failure.
6. Workers receive the explicit JavaScript resource limits and no inherited Node flags or `NODE_OPTIONS`.

The timeout tests use an intentional infinite loop in a disposable worker, not a machine-speed-dependent regex threshold. Timing values in the report are never regression assertions. The [tests](../test/research.test.js) run in the existing Node 24 CI workflow; the full timing experiment is an explicit local command.

## Limits and follow-up

No production engine change was necessary for these observed cases. This work closes a missing work-budget test and adds a reproducible investigation; it does not establish that every expensive path is instrumented.

Only one native expression family, one Node/V8 runtime and one machine were measured. No browser engine, RE2 build, GPU, server endpoint, or operating-system memory isolation was tested. Future runtime versions and regex flags may choose different algorithms. Worker JavaScript memory limits were checked as configuration; no deliberate out-of-memory run was performed.

Node worker termination/recovery is covered. The browser's four-second watchdog, cancellation, stale-response handling, and recovery after a UI error still need browser lifecycle tests. NFA trace cost and rendering cost are outside these measurements. The existing finite input/state bounds remain relevant because the trace retains every frame.

A next experiment should add independently chosen pattern families and a second runtime, retain failing seeds, and examine any genuinely uncovered work before changing limits. It should keep the fixed corpus and disposal boundaries, rather than exposing native pathological matching as an interactive visitor feature.
