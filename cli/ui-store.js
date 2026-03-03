/**
 * In-memory store for UI events emitted by the Ink adapter.
 * CliRoot subscribes to get state updates and re-render.
 */
function createUiStore() {
  const events = [];
  const listeners = new Set();

  function pushEvent(ev) {
    events.push(ev);
    listeners.forEach((fn) => { try { fn(); } catch (_) {} });
  }

  function getState() {
    return { events: [...events] };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { pushEvent, getState, subscribe };
}

module.exports = { createUiStore };
