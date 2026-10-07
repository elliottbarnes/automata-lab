# Automata Lab

A regular expression compiler with bounded construction and independently checked minimization. Write an expression, inspect its NFA, DFA, and minimal DFA, then step through a full-string match.

**[Open the lab](https://elliottbarnes.github.io/automata-lab/)** · [Full guide](reference/guide.md) · [Resource-exhaustion investigation](research/resource-exhaustion.md) · [CI](https://github.com/elliottbarnes/automata-lab/actions/workflows/check.yml)

![A suffix expression compiled into an inspectable minimal DFA](assets/preview.png)

## How it works

- A recursive-descent parser feeds Thompson NFA construction, subset construction, and Moore partition refinement. The browser engine never calls native `RegExp`.
- Deterministic matching reads one transition per input character. Compilation has separate pattern, state, and work budgets; the browser also uses a disposable worker and a four-second watchdog.
- Tests compare all three machines with anchored native regex on bounded corpora. A separate table-filling algorithm checks that every pair of minimal states is distinguishable.

Plain JavaScript, no runtime dependencies, backend, or build step. The [full guide](reference/guide.md) preserves the API, grammar, algorithms, worked example, limits, and extension notes.

## Run locally

Requires Node.js 24+ and Python 3. No package installation is needed.

```sh
git clone https://github.com/elliottbarnes/automata-lab.git
cd automata-lab
npm test
python3 -m http.server 4175 --bind 127.0.0.1 --directory docs
```

Open **http://localhost:4175**. Start with `(a|b)*abb` and `aabb`, then press **Step** to follow the trace.

## Investigate the limits

The [bounded local experiment](research/resource-exhaustion.md) separates native backtracking, deterministic matching, and DFA compilation. It includes exact inputs, runtime details, raw results, and reproduction instructions. The sampled compiler state and work limits rejected as intended; no engine fix was needed for those cases.

```sh
npm run --silent research > /tmp/automata-results.json
```

Each case uses a disposable Node worker with explicit JavaScript memory limits, a case timeout, and a total run deadline. This command runs the fixed research corpus; the browser demo does not expose the native backtracking experiment.

## Scope and verification

This is an educational compiler for **printable ASCII full-string matching**, not a production regex library. It rejects Unicode, flags, anchors, counted repetition, backreferences, lookaround, and shorthand classes. Patterns stop at 256 characters, input at 512, NFA construction at 512 states, DFA construction at 128 states, and compilation at 2,000,000 instrumented operations.

`npm test` runs 28 tests, including 26,145 bounded engine/reference comparisons, independent minimality checks, real work-budget exhaustion, and Node-worker timeout/recovery tests. These checks do not establish arbitrary-pattern correctness, browser cancellation behavior, or whole-process memory isolation. See [verification details](reference/guide.md#verification) and [experiment limitations](research/resource-exhaustion.md#limits-and-follow-up).

MIT · [License](LICENSE)
