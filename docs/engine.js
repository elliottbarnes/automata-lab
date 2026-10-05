/** A dependency-free regular-expression compiler over printable ASCII. */
export const ALPHABET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
export const LIMITS = Object.freeze({ pattern: 256, input: 512, nfaStates: 512, dfaStates: 128, operations: 2_000_000 });
const META = new Set('()[]|*+?.\\^${}');
export class CompileError extends Error {
  constructor(message, offset = null) { super(message); this.name = 'CompileError'; this.offset = offset; }
}
function budget() {
  return { operations: 0, tick(n = 1) { this.operations += n; if (this.operations > LIMITS.operations) throw new CompileError(`Compilation exceeded ${LIMITS.operations.toLocaleString()} operations. Simplify the expression.`); } };
}
export function parse(pattern) {
  if (typeof pattern !== 'string') throw new CompileError('The pattern must be a string.');
  if (pattern.length > LIMITS.pattern) throw new CompileError(`Patterns are limited to ${LIMITS.pattern} characters.`);
  const nonAscii = [...pattern].findIndex(c => !ALPHABET.includes(c));
  if (nonAscii >= 0) throw new CompileError('Only printable ASCII characters (space through ~) are supported.', nonAscii);
  let at = 0;
  const fail = message => { throw new CompileError(message, at); };
  function escaped() {
    at++;
    if (at >= pattern.length) fail('A trailing backslash needs a literal character.');
    const c = pattern[at++];
    if (!META.has(c) && c !== '-' && c !== '/') fail(`Unsupported escape \\${c}. Escape punctuation only; write character classes explicitly.`);
    return c;
  }
  function charClass() {
    at++;
    const invert = pattern[at] === '^';
    if (invert) at++;
    const chars = new Set();
    function element() {
      if (at >= pattern.length || pattern[at] === ']') fail('Expected a character inside the class.');
      if (pattern[at] === '\\') return escaped();
      const c = pattern[at++];
      if (c === '[') fail('Nested character classes are not supported; escape a literal [.');
      return c;
    }
    while (at < pattern.length && pattern[at] !== ']') {
      const first = element();
      if (pattern[at] === '-' && at + 1 < pattern.length && pattern[at + 1] !== ']') {
        at++;
        const last = element();
        if (first.charCodeAt(0) > last.charCodeAt(0)) fail('Character-class ranges must run forwards.');
        for (let n = first.charCodeAt(0); n <= last.charCodeAt(0); n++) chars.add(String.fromCharCode(n));
      } else chars.add(first);
    }
    if (pattern[at] !== ']') fail('Unclosed character class.');
    if (!chars.size) fail('Empty character classes are not supported.');
    at++;
    return { type: 'chars', chars: ALPHABET.filter(c => invert !== chars.has(c)) };
  }
  function atom() {
    const c = pattern[at];
    if (c === '(') {
      at++;
      if (pattern[at] === '?') fail('Lookaround and special group syntax are not supported.');
      const child = alt();
      if (pattern[at] !== ')') fail('Unclosed group.');
      at++;
      return child;
    }
    if (c === '[') return charClass();
    if (c === '.') { at++; return { type: 'chars', chars: [...ALPHABET] }; }
    if (c === '\\') return { type: 'chars', chars: [escaped()] };
    if (META.has(c)) fail(`Unexpected ${c}. Escape it to match it literally. Anchors and counted repetitions are not supported.`);
    at++;
    return { type: 'chars', chars: [c] };
  }
  function repeated() {
    const child = atom();
    if (!['*', '+', '?'].includes(pattern[at])) return child;
    const type = pattern[at++];
    if (['*', '+', '?'].includes(pattern[at])) fail('Use one quantifier per atom. Lazy and stacked quantifiers are not supported.');
    return { type, child };
  }
  function sequence() {
    const children = [];
    while (at < pattern.length && ![')', '|'].includes(pattern[at])) children.push(repeated());
    return children.length === 0 ? { type: 'empty' } : children.length === 1 ? children[0] : { type: 'sequence', children };
  }
  function alt() {
    const children = [sequence()];
    while (pattern[at] === '|') { at++; children.push(sequence()); }
    return children.length === 1 ? children[0] : { type: 'alt', children };
  }
  const ast = alt();
  if (at !== pattern.length) fail('Unexpected closing parenthesis.');
  return ast;
}
function thompson(ast, work) {
  const states = [];
  function state() {
    work.tick();
    if (states.length >= LIMITS.nfaStates) throw new CompileError(`The NFA exceeds the ${LIMITS.nfaStates}-state limit.`);
    const id = states.length; states.push({ id, accept: false, edges: [] }); return id;
  }
  function edge(from, to, chars = null) { work.tick(); states[from].edges.push({ to, chars }); }
  function visit(node) {
    if (node.type === 'chars' || node.type === 'empty') {
      const start = state(), end = state();
      edge(start, end, node.type === 'chars' ? node.chars : null);
      return { start, end };
    }
    if (node.type === 'sequence') {
      const fragments = node.children.map(visit);
      for (let i = 1; i < fragments.length; i++) edge(fragments[i - 1].end, fragments[i].start);
      return { start: fragments[0].start, end: fragments.at(-1).end };
    }
    const start = state(), end = state();
    if (node.type === 'alt') {
      for (const child of node.children) { const fragment = visit(child); edge(start, fragment.start); edge(fragment.end, end); }
    } else {
      const fragment = visit(node.child);
      edge(start, fragment.start); edge(fragment.end, end);
      if (node.type === '*' || node.type === '?') edge(start, end);
      if (node.type === '*' || node.type === '+') edge(fragment.end, fragment.start);
    }
    return { start, end };
  }
  const { start, end } = visit(ast); states[end].accept = true;
  return { kind: 'nfa', start, states };
}
function closure(nfa, initial, work) {
  const seen = new Set(initial), queue = [...initial];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of nfa.states[queue[i]].edges) {
      work?.tick();
      if (edge.chars === null && !seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
    }
  }
  return [...seen].sort((a, b) => a - b);
}
function determinize(nfa, work) {
  // Symbols with identical edge membership induce identical transitions.
  const consuming = nfa.states.flatMap(s => s.edges.filter(e => e.chars !== null));
  const classes = new Map();
  for (const symbol of ALPHABET) {
    const signature = consuming.map(edge => { work.tick(); return edge.chars.includes(symbol) ? '1' : '0'; }).join('');
    if (!classes.has(signature)) classes.set(signature, []);
    classes.get(signature).push(symbol);
  }
  const states = [], known = new Map();
  function intern(members) {
    const key = members.join(',');
    if (known.has(key)) return known.get(key);
    if (states.length >= LIMITS.dfaStates) throw new CompileError(`Subset construction exceeds ${LIMITS.dfaStates} DFA states. This pattern is too complex for the interactive budget.`);
    const id = states.length; known.set(key, id);
    states.push({ id, members, accept: members.some(id => nfa.states[id].accept), transitions: {} });
    return id;
  }
  const start = intern(closure(nfa, [nfa.start], work));
  for (let i = 0; i < states.length; i++) {
    for (const symbols of classes.values()) {
      const next = new Set();
      for (const member of states[i].members) for (const edge of nfa.states[member].edges) {
        work.tick();
        if (edge.chars !== null && edge.chars.includes(symbols[0])) next.add(edge.to);
      }
      const destination = intern(closure(nfa, [...next], work));
      for (const symbol of symbols) { work.tick(); states[i].transitions[symbol] = destination; }
    }
  }
  return { kind: 'dfa', start, states, alphabetClasses: [...classes.values()] };
}
function minimize(dfa, work) {
  let groups = [dfa.states.filter(s => !s.accept).map(s => s.id), dfa.states.filter(s => s.accept).map(s => s.id)].filter(g => g.length);
  let rounds = 0;
  while (true) {
    rounds++;
    const membership = new Map(groups.flatMap((group, i) => group.map(id => [id, i])));
    const refined = [];
    for (const group of groups) {
      const split = new Map();
      for (const id of group) {
        const signature = ALPHABET.map(c => { work.tick(); return membership.get(dfa.states[id].transitions[c]); }).join(',');
        if (!split.has(signature)) split.set(signature, []);
        split.get(signature).push(id);
      }
      refined.push(...split.values());
    }
    if (refined.length === groups.length) break;
    groups = refined;
  }
  const membership = new Map(groups.flatMap((group, i) => group.map(id => [id, i])));
  const unsorted = groups.map((members, id) => ({ id, members, accept: dfa.states[members[0]].accept,
    transitions: Object.fromEntries(ALPHABET.map(c => [c, membership.get(dfa.states[members[0]].transitions[c])])) }));
  // Breadth-first numbering starts at zero and stays stable for inspection.
  const order = [membership.get(dfa.start)], seen = new Set(order);
  for (let i = 0; i < order.length; i++) for (const c of ALPHABET) {
    const next = unsorted[order[i]].transitions[c];
    if (!seen.has(next)) { seen.add(next); order.push(next); }
  }
  const remap = new Map(order.map((old, id) => [old, id]));
  const states = order.map((old, id) => ({ ...unsorted[old], id,
    transitions: Object.fromEntries(ALPHABET.map(c => [c, remap.get(unsorted[old].transitions[c])])) }));
  return { kind: 'min', start: 0, states, rounds };
}
export function compile(pattern) {
  const work = budget(), ast = parse(pattern);
  const nfa = thompson(ast, work), dfa = determinize(nfa, work), min = minimize(dfa, work);
  return { pattern, ast, nfa, dfa, min, operations: work.operations };
}
export function trace(machine, input) {
  if (typeof input !== 'string') throw new CompileError('The input must be a string.');
  if (input.length > LIMITS.input) throw new CompileError(`Inputs are limited to ${LIMITS.input} characters.`);
  if ([...input].some(c => !ALPHABET.includes(c))) throw new CompileError('Input must use printable ASCII (space through ~).');
  let active = machine.kind === 'nfa' ? closure(machine, [machine.start]) : [machine.start];
  const frames = [{ index: 0, symbol: null, active, accept: active.some(id => machine.states[id].accept) }];
  for (let index = 0; index < input.length; index++) {
    const symbol = input[index];
    if (machine.kind === 'nfa') {
      const next = new Set();
      for (const id of active) for (const edge of machine.states[id].edges) if (edge.chars !== null && edge.chars.includes(symbol)) next.add(edge.to);
      active = closure(machine, [...next]);
    } else active = [machine.states[active[0]].transitions[symbol]];
    frames.push({ index: index + 1, symbol, active, accept: active.some(id => machine.states[id].accept) });
  }
  return { accepted: frames.at(-1).accept, frames };
}
export function labelChars(chars, maxLength = 25) {
  if (chars === null) return 'ε';
  if (chars.length === ALPHABET.length) return 'any';
  const sorted = [...new Set(chars)].sort(), parts = [];
  const readable = c => c === ' ' ? '␠' : c;
  for (let i = 0; i < sorted.length; i++) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1].charCodeAt(0) === sorted[end].charCodeAt(0) + 1) end++;
    if (end - i >= 2) { parts.push(`${readable(sorted[i])}–${readable(sorted[end])}`); i = end; }
    else parts.push(readable(sorted[i]));
  }
  const label = parts.join(', ');
  return label.length > maxLength ? `${chars.length} chars` : label;
}
export function graphEdges(machine) {
  return machine.states.flatMap(state => {
    if (machine.kind === 'nfa') return state.edges.map(edge => ({ from: state.id, to: edge.to, chars: edge.chars }));
    const destinations = new Map();
    for (const c of ALPHABET) {
      const to = state.transitions[c];
      if (!destinations.has(to)) destinations.set(to, []);
      destinations.get(to).push(c);
    }
    return [...destinations].map(([to, chars]) => ({ from: state.id, to, chars }));
  });
}
