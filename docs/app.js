import { trace, graphEdges, labelChars, ALPHABET, LIMITS } from './engine.js';
const $ = id => document.getElementById(id);
const examples = {
  suffix: ['(a|b)*abb', 'aabb'],
  identifier: ['[a-zA-Z_][a-zA-Z0-9_]*', '_item7'],
  email: ['[a-z]+@[a-z]+\\.[a-z]+', 'hello@lab.dev'],
};
const stages = {
  nfa: ['Many possible states. One expression.', 'Epsilon transitions connect fragments without consuming input.'],
  dfa: ['One character. One certain next state.', 'Each state is an epsilon-closed set of NFA states.'],
  min: ['The smallest equivalent machine.', 'States with identical future behavior become one.'],
};
let worker, sequence = 0, model, stage = 'min', stepIndex = 0, selected = 0, history, lastStatus = '', compilationPending = false;
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, content) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}
function error(id, message) { $(id).hidden = !message; $(id).textContent = message || ''; }
function patternState() {
  $('pattern-count').textContent = `${$('pattern').value.length} / ${LIMITS.pattern}`;
  if (model && !compilationPending) $('build-status').textContent = $('pattern').value === model.pattern ? lastStatus : `Uncompiled changes · showing the last valid pattern: /${model.pattern}/`;
}
function compilePattern() {
  worker?.terminate();
  const id = ++sequence;
  compilationPending = true;
  error('compile-error', '');
  $('build-status').textContent = 'Compiling in an isolated worker…';
  $('compile-button').firstChild.textContent = 'Compiling… ';
  let timeout;
  const fail = message => {
    if (id !== sequence) return;
    clearTimeout(timeout); worker?.terminate(); compilationPending = false;
    error('compile-error', message);
    $('compile-button').firstChild.textContent = 'Compile expression ';
    $('build-status').textContent = model ? `Compilation failed · displaying the last valid pattern: /${model.pattern}/` : 'Compilation failed. Edit the expression to try again.';
  };
  try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
  catch { fail('The compilation worker could not start. Open this demo over HTTP or HTTPS using the development server.'); return; }
  timeout = setTimeout(() => fail('Compilation exceeded the 4-second interactive time limit. Simplify the expression and try again.'), 4000);
  worker.onerror = () => fail('The compilation worker could not load. Reload the page, or serve the docs folder over HTTP.');
  worker.onmessage = ({ data }) => {
    if (data.id !== sequence) return;
    if (data.error) { fail(`${data.error}${data.offset === null || data.offset === undefined ? '' : ` (Character ${data.offset + 1})`}`); return; }
    clearTimeout(timeout); worker.terminate(); compilationPending = false;
    model = data.result; stepIndex = 0; selected = model[stage].start;
    $('compile-button').firstChild.textContent = 'Compile expression ';
    lastStatus = `${model.operations.toLocaleString()} operations · ${data.elapsed.toFixed(1)} ms on this device · ${model.min.rounds} refinement rounds`;
    $('nfa-count').textContent = model.nfa.states.length;
    $('dfa-count').textContent = model.dfa.states.length;
    $('min-count').textContent = model.min.states.length;
    $('operation-count').textContent = model.operations < 1000 ? model.operations : `${(model.operations / 1000).toFixed(1)}k`;
    $('operation-count').title = `${model.operations.toLocaleString()} budgeted compilation operations`;
    patternState(); setupStage();
  };
  worker.postMessage({ id, pattern: $('pattern').value });
}
function updateTrace(reset = false) {
  if (!model) return;
  try { history = trace(model[stage], $('test-input').value); error('input-error', ''); }
  catch (err) { history = null; error('input-error', err.message); }
  if (reset) stepIndex = 0;
  if (history) stepIndex = Math.min(stepIndex, history.frames.length - 1);
  const accepted = history?.accepted;
  $('verdict').classList.toggle('rejected', !accepted);
  $('verdict').querySelector('.verdict-icon').textContent = accepted ? '✓' : '×';
  $('verdict').querySelector('strong').textContent = history ? (accepted ? 'Accepted' : 'Rejected') : 'Unsupported input';
  $('verdict').querySelector('small').textContent = history ? (accepted ? 'The complete string matches.' : 'The complete string does not match.') : 'Check the input restrictions below.';
  updateFrame();
}
function updateFrame() {
  const frame = history?.frames[stepIndex], input = $('test-input').value;
  $('reset').disabled = !history || stepIndex === 0;
  $('back').disabled = !history || stepIndex === 0;
  $('step').disabled = !history || stepIndex === input.length;
  $('finish').disabled = !history || stepIndex === input.length;
  $('tape').replaceChildren();
  if (history && input.length === 0) { const empty = document.createElement('span'); empty.textContent = 'ε'; empty.className = 'consumed'; $('tape').append(empty); }
  else if (history) [...input].forEach((char, index) => {
    const cell = document.createElement('span'); cell.textContent = char === ' ' ? '␠' : char;
    if (index < stepIndex) cell.className = 'consumed';
    if (index === stepIndex) cell.className = 'next';
    $('tape').append(cell);
  });
  if (frame) {
    const stateCount = frame.active.length;
    $('trace-caption').textContent = `${stepIndex} / ${input.length} characters consumed · ${stateCount} active state${stateCount === 1 ? '' : 's'}${stepIndex === input.length ? ' · end of input' : ''}`;
    if (frame.active.length && !frame.active.includes(selected)) selected = frame.active[0];
    $('state-select').value = selected;
  } else $('trace-caption').textContent = 'Enter printable ASCII to inspect a trace.';
  if (model) { drawGraph(); renderState(); }
}
function setupStage() {
  for (const button of document.querySelectorAll('[data-stage]')) {
    const active = button.dataset.stage === stage;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  $('machine-panel').setAttribute('aria-labelledby', `tab-${stage}`);
  $('stage-title').textContent = stages[stage][0]; $('stage-description').textContent = stages[stage][1];
  if (!model) return;
  const machine = model[stage];
  selected = Math.min(selected, machine.states.length - 1);
  $('graph-badge').textContent = `${machine.states.length} STATES`;
  $('state-select').replaceChildren(...machine.states.map(state => { const option = document.createElement('option'); option.value = state.id; option.textContent = `q${state.id}`; return option; }));
  updateTrace();
}
function selectState(id) { selected = id; $('state-select').value = id; drawGraph(); renderState(); }
function drawGraph() {
  const machine = model[stage], graph = $('graph'), allEdges = graphEdges(machine), active = history?.frames[stepIndex]?.active || [];
  let visible = machine.states.map(s => s.id);
  if (visible.length > 24) {
    const neighbors = allEdges.filter(e => e.from === selected || e.to === selected).flatMap(e => [e.from, e.to]);
    visible = [...new Set([selected, ...neighbors, ...active])].slice(0, 24).sort((a, b) => a - b);
    $('graph-notice').hidden = false;
    $('graph-notice').textContent = `Focused view: ${visible.length} of ${machine.states.length} states. Choose a state to explore its neighborhood. The transition table includes every outgoing edge, including destinations outside this view.`;
  } else $('graph-notice').hidden = true;
  const positions = new Map();
  const radiusX = visible.length <= 4 ? 190 : 265, radiusY = visible.length <= 4 ? 110 : 146;
  visible.forEach((id, i) => {
    const angle = (i / visible.length) * Math.PI * 2 + Math.PI;
    positions.set(id, visible.length === 1 ? { x: 380, y: 200 } : { x: 380 + radiusX * Math.cos(angle), y: 205 + radiusY * Math.sin(angle) });
  });
  graph.replaceChildren(svg('title', { id: 'graph-title' }, `${stage.toUpperCase()} with ${machine.states.length} states`), svg('desc', { id: 'graph-description' }, `Active states: ${active.map(id => `q${id}`).join(', ') || 'none'}. Double circles accept. Use the state selector and transition table for text details.`));
  const defs = svg('defs');
  for (const [id, color] of [['arrow', '#627952'], ['arrow-active', '#c6f28e']]) {
    const marker = svg('marker', { id, markerWidth: 8, markerHeight: 7, refX: 7, refY: 3.5, orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svg('path', { d: 'M0,0 L8,3.5 L0,7 Z', fill: color })); defs.append(marker);
  }
  graph.append(defs);
  const edgesGroup = svg('g'), labelsGroup = svg('g'), nodesGroup = svg('g');
  const visibleEdges = allEdges.filter(e => positions.has(e.from) && positions.has(e.to));
  for (const edge of visibleEdges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    let path, label;
    if (edge.from === edge.to) {
      const dx = from.x - 380, dy = from.y - 205, length = Math.hypot(dx, dy) || 1;
      const ux = length === 1 ? 0 : dx / length, uy = length === 1 ? -1 : dy / length;
      const px = -uy, py = ux;
      const a = { x: from.x + ux * 13 + px * 17, y: from.y + uy * 13 + py * 17 };
      const b = { x: from.x + ux * 13 - px * 17, y: from.y + uy * 13 - py * 17 };
      path = `M${a.x},${a.y} C${from.x + ux * 74 + px * 48},${from.y + uy * 74 + py * 48} ${from.x + ux * 74 - px * 48},${from.y + uy * 74 - py * 48} ${b.x},${b.y}`;
      label = { x: from.x + ux * 65, y: from.y + uy * 65 };
    } else {
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      const bend = visibleEdges.some(e => e.from === edge.to && e.to === edge.from) ? 38 : (visible.length > 8 ? 18 : 0);
      const cx = (from.x + to.x) / 2 - uy * bend, cy = (from.y + to.y) / 2 + ux * bend;
      const startAngle = Math.atan2(cy - from.y, cx - from.x), endAngle = Math.atan2(cy - to.y, cx - to.x);
      const a = { x: from.x + Math.cos(startAngle) * 24, y: from.y + Math.sin(startAngle) * 24 };
      const b = { x: to.x + Math.cos(endAngle) * 27, y: to.y + Math.sin(endAngle) * 27 };
      path = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
      label = { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 - 7 };
    }
    const previous = history?.frames[stepIndex - 1], current = history?.frames[stepIndex];
    const hot = previous && current && current.active.includes(edge.to) && ((edge.chars === null && current.active.includes(edge.from)) || (previous.active.includes(edge.from) && edge.chars?.includes(current.symbol)));
    const line = svg('path', { d: path, class: `edge${hot ? ' active-edge' : ''}`, 'marker-end': `url(#${hot ? 'arrow-active' : 'arrow'})` });
    line.append(svg('title', {}, `q${edge.from} → q${edge.to}: ${labelChars(edge.chars, 1000)}`)); edgesGroup.append(line);
    labelsGroup.append(svg('text', { x: label.x, y: label.y, class: 'edge-label', 'text-anchor': 'middle' }, labelChars(edge.chars, 18)));
  }
  if (positions.has(machine.start)) {
    const p = positions.get(machine.start), marker = svg('path', { d: `M${p.x - 63},${p.y} L${p.x - 28},${p.y}`, class: 'edge', 'marker-end': 'url(#arrow)' });
    edgesGroup.append(marker); labelsGroup.append(svg('text', { x: p.x - 64, y: p.y - 9, class: 'edge-label' }, 'start'));
  }
  visible.forEach(id => {
    const p = positions.get(id), state = machine.states[id];
    const group = svg('g', { class: `state${active.includes(id) ? ' active' : ''}${selected === id ? ' selected' : ''}`, transform: `translate(${p.x} ${p.y})`, 'data-state': id });
    group.append(svg('title', {}, `q${id}${state.accept ? ', accepting' : ''}. Click to inspect.`), svg('circle', { r: 23, class: 'state-circle' }));
    if (state.accept) group.append(svg('circle', { r: 18, class: 'state-ring' }));
    group.append(svg('text', { class: 'state-label', y: 1 }, `q${id}`)); group.addEventListener('click', () => selectState(id)); nodesGroup.append(group);
  });
  graph.append(edgesGroup, labelsGroup, nodesGroup);
}
function renderState() {
  const machine = model[stage], state = machine.states[selected];
  $('state-select').value = selected;
  $('state-status').textContent = state.accept ? 'ACCEPTING' : 'NON-ACCEPTING';
  const origin = stage === 'nfa' ? 'A Thompson fragment state. ε edges do not consume input.' : stage === 'dfa' ? `NFA subset: {${state.members.map(id => `q${id}`).join(', ') || '∅'}}${state.members.length ? '' : ' · dead state'}` : `Merged DFA states: {${state.members.map(id => `q${id}`).join(', ')}}`;
  $('state-origin').textContent = origin;
  const edges = graphEdges(machine).filter(e => e.from === selected);
  const rows = edges.map(edge => {
    const row = document.createElement('tr'), symbol = document.createElement('td'), destination = document.createElement('td'), count = document.createElement('td');
    symbol.textContent = labelChars(edge.chars, 200); const link = document.createElement('button'); link.textContent = `q${edge.to}`; link.setAttribute('aria-label', `Inspect destination q${edge.to}`); link.addEventListener('click', () => selectState(edge.to)); destination.append(link);
    count.textContent = edge.chars === null ? 'No input' : `${edge.chars.length} of ${ALPHABET.length}`;
    row.append(symbol, destination, count); return row;
  });
  if (!rows.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 3; cell.textContent = 'No outgoing transitions.'; row.append(cell); rows.push(row); }
  $('transitions').replaceChildren(...rows);
}
$('compile-form').addEventListener('submit', event => { event.preventDefault(); compilePattern(); });
$('pattern').addEventListener('input', () => { patternState(); for (const example of document.querySelectorAll('[data-example]')) example.classList.remove('active'); });
$('test-input').addEventListener('input', () => updateTrace(true));
for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => {
  [$('pattern').value, $('test-input').value] = examples[button.dataset.example];
  for (const example of document.querySelectorAll('[data-example]')) example.classList.toggle('active', example === button);
  patternState(); compilePattern();
});
for (const button of document.querySelectorAll('[data-stage]')) {
  button.addEventListener('click', () => { stage = button.dataset.stage; selected = model?.[stage].start || 0; setupStage(); });
  button.addEventListener('keydown', event => {
    const buttons = [...document.querySelectorAll('[data-stage]')], index = buttons.indexOf(button);
    let next;
    if (event.key === 'ArrowRight') next = buttons[(index + 1) % buttons.length];
    if (event.key === 'ArrowLeft') next = buttons[(index + buttons.length - 1) % buttons.length];
    if (event.key === 'Home') next = buttons[0];
    if (event.key === 'End') next = buttons.at(-1);
    if (next) { event.preventDefault(); next.focus(); next.click(); }
  });
}
$('state-select').addEventListener('change', () => selectState(Number($('state-select').value)));
$('reset').addEventListener('click', () => { stepIndex = 0; updateFrame(); });
$('back').addEventListener('click', () => { if (stepIndex > 0) stepIndex--; updateFrame(); });
$('step').addEventListener('click', () => { if (history && stepIndex < history.frames.length - 1) stepIndex++; updateFrame(); });
$('finish').addEventListener('click', () => { if (history) stepIndex = history.frames.length - 1; updateFrame(); });
patternState(); setupStage(); compilePattern();
