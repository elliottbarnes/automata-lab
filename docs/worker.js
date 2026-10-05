import { compile } from './engine.js';
self.onmessage = ({ data }) => {
  const started = performance.now();
  try { self.postMessage({ id: data.id, result: compile(data.pattern), elapsed: performance.now() - started }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message, offset: error.offset }); }
};
