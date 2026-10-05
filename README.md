# Automata Lab

An inspectable regular expression compiler. Write an expression, follow its transformation into three equivalent machines, and step through a full-string match one character at a time.

**[Open the interactive lab](https://elliottbarnes.github.io/automata-lab/)**

![Automata Lab compiling a suffix-matching expression into a minimal DFA](assets/preview.png)

This is a working compiler and automaton simulator, built without dependencies. The production engine never calls JavaScript's `RegExp`; native regex is used only as an independent reference in tests.

## Run it

Requires Node.js 24+ for tests and Python 3 for the included development-server command.

```sh
npm test
npm run serve
# Open http://localhost:4175
```

No install or build step is needed. `docs/` is a self-contained static site. Serve it over HTTP or HTTPS because ES modules and module workers do not load reliably from `file://` URLs. For GitHub Pages, publish the `main` branch's `/docs` directory.

## How it works

1. **Recursive-descent parsing** builds an abstract syntax tree. Precedence is repetition, then concatenation, then alternation. Syntax errors include a source offset.
2. **Thompson construction** turns syntax nodes into fragments with one entry and one exit. Concatenation, alternation and repetition connect these fragments with epsilon transitions.
3. **Subset construction** creates a reachable, total DFA. Each state is an epsilon-closed set of NFA states. The empty subset becomes an explicit dead state when reachable. Characters with identical NFA edge membership are grouped during construction; the result still contains all 95 transitions per state.
4. **Moore partition refinement** starts with accepting and non-accepting groups and repeatedly splits groups according to their transition destinations. The stable partition gives a minimal DFA for the complete printable-ASCII alphabet. The result is renumbered by breadth-first traversal for consistent inspection.
5. **Simulation** follows either epsilon-closed NFA state sets or a single deterministic state. The trace includes the initial configuration and one frame per input character. Acceptance requires an accepting state *after the entire string* is consumed.

The interface displays the three graphs, state counts, measured compiler work, device-local compilation duration, minimization rounds, each state's origin, and a complete outgoing transition table. Diagram nodes, the state selector, and transition destinations all support inspection. Compilation happens in a disposable Web Worker. A new compilation terminates the preceding worker.

### Source map

| File | Responsibility |
| --- | --- |
| `docs/engine.js` | Grammar, compiler passes, limits, simulation, graph helpers |
| `docs/worker.js` | Isolated compilation and structured errors |
| `docs/app.js` | UI state, SVG drawing, trace controls, state inspection |
| `docs/index.html`, `docs/style.css` | Accessible controls, responsive presentation |
| `test/engine.test.js` | Differential, invariant, minimization, and limit tests |

## Grammar and semantics

```text
expression  := sequence ("|" sequence)*
sequence    := repetition*
repetition  := atom ("*" | "+" | "?")?
atom        := literal | escaped-punctuation | "."
             | "(" expression ")" | character-class
character-class := "[" "^"? (class-character ("-" class-character)?)+ "]"
```

- Alphabet: **95 printable ASCII characters**, from space (U+0020) through tilde (U+007E).
- `.` means any character in that alphabet. `[^a]` means every character in that alphabet except `a`.
- `*`, `+`, and `?` mean zero-or-more, one-or-more, and optional. They do not express greedy/lazy preferences: this engine recognizes languages and does not extract captures.
- Grouping uses parentheses. Empty expressions, groups, and alternatives are valid and denote epsilon.
- Character classes support inclusive ranges, unions, negation, escaped punctuation, and literal `-` at an edge. A nested `[` must be escaped. Empty classes are rejected.
- Escape punctuation such as `\*`, `\[`, `\]`, `\\`, and `\.` to match it literally.
- All matching is anchored to the full input. Do not add `^` or `$`.
- Unicode, control characters, flags, anchors, capture extraction, shorthand classes (`\d`, `\w`, `\s`), counted repetition, backreferences, lookaround, special groups, and stacked/lazy quantifiers are intentionally unsupported and rejected explicitly.

The “Email shape” preset is an illustrative regular language, **not an email address validator**.

## Bounds and tradeoffs

| Bound | Value |
| --- | --- |
| Pattern length | 256 ASCII characters |
| Input length | 512 ASCII characters |
| Thompson NFA | 512 states |
| Reachable DFA | 128 states |
| Budgeted compilation operations | 2,000,000 |
| UI compilation watchdog | 4 seconds |
| Diagram nodes | 24 at once |

Subset construction is exponential in the worst case; this lab rejects excessive expressions rather than silently truncating the machine. State and work limits are deterministic. The UI watchdog additionally terminates slow workers. Larger graphs switch to a selected-state neighborhood, and explicitly report the number displayed; every state remains selectable and its transition table stays complete.

The operation counter counts construction, closure, subset, and partition-refinement work at the instrumented primitive level. It is an explanatory metric, not a CPU instruction count or cross-project benchmark. Compilation duration is measured on the current device. SVG layout is deliberately simple and circular: dense diagrams can overlap, so the transition table is the authoritative exact view.

This uses Moore refinement rather than Hopcroft's asymptotically faster algorithm. The smaller implementation is easy to inspect and suitable for the bounded 128-state interactive budget.

## Verification

Run `npm test` for tests covering:

- Exhaustive short-string equivalence among NFA, DFA, minimal DFA and anchored native JavaScript regex, over a supported common subset.
- Deterministic generated regexes and exhaustive small input sets, including nullable nested repetition.
- Independently verified minimality via the table-filling distinguishability algorithm.
- Known minimal state counts, total transition functions, reachability and graph fidelity.
- Invalid syntax, unsupported features, source/NFA/DFA/input limits, empty input, and epsilon closures.

No performance speedup is claimed. The implementation exposes how construction and minimization change representation while preserving behavior.

## License

MIT. See [LICENSE](LICENSE).
