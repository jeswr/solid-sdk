// AUTHORED-BY Codex GPT-6
// Lossless explorer-copy decoding, shared by the browser accessor and the bundler.
(function (root) {
  'use strict';
  function restore(trace) {
    var copy = trace.explorerCopy;
    if (!copy) return trace;
    if (copy.encoding !== 'event-values/1' || !Array.isArray(copy.values) || !Array.isArray(copy.refs)) {
      throw new Error('Unsupported explorer trace encoding.');
    }
    copy.refs.forEach(function (ref) {
      var path = ref[0], index = ref[1];
      if (!Array.isArray(path) || path.length < 2 || !Number.isInteger(index) || index < 0 || index >= copy.values.length ||
          !(path[0] === 'events' || (path[0] === 'explorerCopy' && path[1] === 'values'))) {
        throw new Error('Invalid explorer trace reference.');
      }
      var owner = trace;
      path.forEach(function (key, i) {
        if ((typeof key !== 'string' && !Number.isInteger(key)) ||
            !owner || !Object.prototype.hasOwnProperty.call(owner, key)) throw new Error('Invalid explorer trace path.');
        if (i < path.length - 1) owner = owner[key];
      });
      var field = path[path.length - 1];
      if (owner[field] !== null) throw new Error('Invalid explorer trace reference target.');
      // Each occurrence gets its own object: view decoration must not alter another event.
      Object.defineProperty(owner, field, { value: JSON.parse(JSON.stringify(copy.values[index])), enumerable: true, writable: true, configurable: true });
    });
    delete trace.explorerCopy;
    return trace;
  }
  var api = { restore: restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AXTraceData = api;
})(typeof window !== 'undefined' ? window : globalThis);
