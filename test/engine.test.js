import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, LIMITS, compile, trace, parse, graphEdges } from '../docs/engine.js';

const accepts = (machine, input) => trace(machine, input).accepted;
function strings(alphabet, length) {
  const result = [''];
  let layer = [''];
  for (let i = 0; i < length; i++) { layer = layer.flatMap(prefix => alphabet.map(c => prefix + c)); result.push(...layer); }
  return result;
}
const examples = [
  ['', ['', true], ['a', false]],
  ['a', ['a', true], ['aa', false]],
  ['(a|b)*abb', ['abb', true], ['ababb', true], ['abab', false]],
  ['[a-zA-Z_][a-zA-Z0-9_]*', ['_item7', true], ['7item', false]],
  ['[a-z]+@[a-z]+\\.[a-z]+', ['a@b.co', true], ['a@@b.co', false]],
  ['[^a-c]+', ['xyz', true], ['ad', false]],
  ['(a|)b?', ['', true], ['ab', true], ['bb', false]],
  ['(a?)*', ['', true], ['aaa', true], ['b', false]],
  ['.', [' ', true], ['', false]],
  ['[^ -~]', ['', false], ['a', false]],
  ['[-a]+', ['a-a', true], ['b', false]],
  ['[a\\-]+', ['a-a', true], ['b', false]],
  ['\\*\\+\\?', ['*+?', true], ['?', false]],
];
for (const [pattern, ...cases] of examples) test(`full-match examples: ${JSON.stringify(pattern)}`, () => {
  const result = compile(pattern);
  for (const [input, expected] of cases) for (const name of ['nfa', 'dfa', 'min']) assert.equal(accepts(result[name], input), expected, `${name}: ${input}`);
});
test('NFA, DFA, minimal DFA and anchored native RegExp agree exhaustively', () => {
  const patterns = ['', 'a', 'a|b', 'ab*', '(ab)+', '(a|b)*abb', '(a?)*', '(a|)*b?', 'a?b+c*', '[a-c]*', '[^b]+', 'a.b', '[a-b]?(a|c)+', '(aa|ab|ba|bb)*', '(a|b)*(a|b)(a|b)'];
  const inputs = strings(['a', 'b', 'c', ' '], 4);
  for (const pattern of patterns) {
    const compiled = compile(pattern), reference = new RegExp(`^(?:${pattern})$`);
    for (const input of inputs) for (const kind of ['nfa', 'dfa', 'min']) assert.equal(accepts(compiled[kind], input), reference.test(input), `${pattern} / ${JSON.stringify(input)} / ${kind}`);
  }
});
test('deterministic generated regexes agree with native RegExp', () => {
  let seed = 742;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  function pattern(depth) {
    if (depth === 0) return ['a', 'b', '[ab]', '[^a]', '.', ''][random(6)];
    const a = pattern(depth - 1), b = pattern(depth - 1);
    return [`(${a}|${b})`, `(${a})(${b})`, `(${a})*`, `(${a})+`, `(${a})?`][random(5)];
  }
  const inputs = strings(['a', 'b', '!'], 3);
  for (let i = 0; i < 90; i++) {
    const regex = pattern(3), compiled = compile(regex), reference = new RegExp(`^(?:${regex})$`);
    for (const input of inputs) for (const kind of ['nfa', 'dfa', 'min']) assert.equal(accepts(compiled[kind], input), reference.test(input), `${regex} / ${input} / ${kind}`);
  }
});
test('known minimal state counts include the total DFA dead state', () => {
  for (const [pattern, count] of [['', 2], ['a', 3], ['a*', 2], ['.*', 1], ['(a|b)*abb', 5], ['a|b', 3], ['[ -~]*', 1]]) assert.equal(compile(pattern).min.states.length, count, pattern);
});
test('all deterministic states are reachable and transitions are total', () => {
  for (const pattern of examples.map(x => x[0])) {
    const result = compile(pattern);
    for (const kind of ['dfa', 'min']) {
      const machine = result[kind], visited = new Set([machine.start]), queue = [machine.start];
      for (let i = 0; i < queue.length; i++) {
        const state = machine.states[queue[i]];
        assert.equal(Object.keys(state.transitions).length, ALPHABET.length);
        for (const symbol of ALPHABET) {
          const to = state.transitions[symbol];
          assert.ok(machine.states[to]);
          if (!visited.has(to)) { visited.add(to); queue.push(to); }
        }
      }
      assert.equal(visited.size, machine.states.length);
    }
  }
});
test('every minimal DFA state pair is distinguishable', () => {
  // Table-filling independently verifies no equivalent pair survived minimization.
  for (const pattern of examples.map(x => x[0])) {
    const { min } = compile(pattern), marks = new Set();
    const key = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
    for (const a of min.states) for (const b of min.states) if (a.id < b.id && a.accept !== b.accept) marks.add(key(a.id, b.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of min.states) for (const b of min.states) if (a.id < b.id && !marks.has(key(a.id, b.id)) && ALPHABET.some(c => marks.has(key(a.transitions[c], b.transitions[c])))) { marks.add(key(a.id, b.id)); changed = true; }
    }
    assert.equal(marks.size, min.states.length * (min.states.length - 1) / 2, pattern);
  }
});
test('invalid and unsupported syntax fails explicitly', () => {
  for (const pattern of ['(', 'a)', '[abc', '[z-a]', '[]', '[^]', '*a', 'a**', 'a+?', '(?=a)', '(?:a)', '\\d+', '\\1', 'a{2}', '^a$', '\\', 'é', 'a\nb', '[[]']) assert.throws(() => parse(pattern), { name: 'CompileError' }, pattern);
});
test('bounded source, NFA, DFA, and input protect interactive runtime', () => {
  assert.throws(() => compile('a'.repeat(LIMITS.pattern + 1)), /Patterns are limited/);
  assert.throws(() => compile('(a|b)*a' + '(a|b)'.repeat(8)), /128 DFA states/);
  assert.throws(() => compile('|'.repeat(256)), /512-state limit/);
  const { min } = compile('.*');
  assert.throws(() => trace(min, 'a'.repeat(LIMITS.input + 1)), /Inputs are limited/);
  assert.throws(() => trace(min, '\n'), /printable ASCII/);
  assert.throws(() => trace(min, '🙂'), /printable ASCII/);
  assert.equal(trace(min, '~'.repeat(LIMITS.input)).accepted, true);
});
test('trace exposes initial epsilon closure and one frame per consumed symbol', () => {
  const { nfa, min } = compile('a?');
  const traceNfa = trace(nfa, 'a');
  assert.equal(traceNfa.frames.length, 2);
  assert.equal(traceNfa.frames[0].accept, true);
  assert.ok(traceNfa.frames[0].active.length > 1);
  assert.equal(traceNfa.frames[1].symbol, 'a');
  assert.equal(trace(min, 'b').accepted, false);
  assert.equal(trace(min, '').accepted, true);
});
test('graphs preserve every deterministic transition', () => {
  const { min } = compile('[a-z]+');
  const edges = graphEdges(min);
  for (const state of min.states) for (const c of ALPHABET) assert.equal(edges.filter(e => e.from === state.id && e.chars.includes(c)).length, 1);
});
