const React = require('react');

const e = React.createElement;
const { useState, useEffect } = React;

function createCliRoot(ink, SpinnerComponent) {
  const { Text, Box } = ink;

  function StatusLine({ label, value, color }) {
    return e(Box, null,
      e(Text, { bold: true }, label + ': '),
      e(Text, { color: color || 'white' }, value)
    );
  }

  function ErrorMessage({ message }) {
    return e(Text, { color: 'red' }, '✗ ' + message);
  }

  function SuccessMessage({ message }) {
    return e(Text, { color: 'green' }, message);
  }

  function SpinnerWithLabel({ label }) {
    return e(Box, null,
      e(Text, { color: 'cyan' }, e(SpinnerComponent, { type: 'dots' })),
      e(Text, null, ' ' + label)
    );
  }

  function ProgressBar({ current, total, label }) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const barLen = 20;
    const filled = total > 0 ? Math.min(barLen, Math.round((current / total) * barLen)) : 0;
    const empty = barLen - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return e(Box, null,
      e(Text, { color: 'cyan' }, '  ' + bar + ' ' + pct + '%'),
      label ? e(Text, { color: 'gray' }, ' ' + label) : null
    );
  }

  function SummaryView({ stats }) {
    if (!stats || typeof stats !== 'object') return null;
    const parts = [];
    if (stats.added != null) parts.push(e(Text, { key: 'a', color: 'green' }, stats.added + ' added'));
    if (stats.updated != null) parts.push(e(Text, { key: 'u', color: 'cyan' }, stats.updated + ' updated'));
    if (stats.removed != null) parts.push(e(Text, { key: 'r', color: 'red' }, stats.removed + ' removed'));
    if (stats.failed != null) parts.push(e(Text, { key: 'f', color: 'red' }, stats.failed + ' failed'));
    if (stats.skipped != null) parts.push(e(Text, { key: 's', color: 'yellow' }, stats.skipped + ' skipped'));
    if (stats.unchanged != null) parts.push(e(Text, { key: 'n', color: 'gray' }, stats.unchanged + ' unchanged'));
    if (parts.length === 0) return null;
    const withCommas = [];
    parts.forEach((p, i) => {
      if (i > 0) withCommas.push(e(Text, { key: 'sep' + i }, ', '));
      withCommas.push(p);
    });
    return e(Box, { flexDirection: 'row' }, ...withCommas);
  }

  function CliRoot({ store, command }) {
    const [state, setState] = useState(store ? store.getState() : { events: [] });

    useEffect(() => {
      if (!store || !store.subscribe) return undefined;
      const unsub = store.subscribe(() => setState(store.getState()));
      return unsub;
    }, [store]);

    const events = state.events || [];
    const steps = [];
    const progressById = {};
    let lastSummary = null;
    let lastError = null;
    let currentStepLabel = null;
    let stepKey = 0;

    events.forEach((ev) => {
      if (ev.type === 'step') {
        steps.push({ type: 'step', label: ev.label, detail: ev.detail, key: stepKey++ });
        currentStepLabel = ev.label;
      } else if (ev.type === 'header') {
        steps.push({ type: 'header', text: ev.text, key: stepKey++ });
      } else if (ev.type === 'dim') {
        steps.push({ type: 'dim', message: ev.message, key: stepKey++ });
      } else if (ev.type === 'info') {
        steps.push({ type: 'info', message: ev.message, key: stepKey++ });
      } else if (ev.type === 'warn') {
        steps.push({ type: 'warn', message: ev.message, key: stepKey++ });
      } else if (ev.type === 'fail') {
        lastError = ev.message;
        // Do not add to steps; we show it once in the error box below to avoid duplicate output
      } else if (ev.type === 'ok') {
        steps.push({ type: 'ok', message: ev.message, key: stepKey++ });
      } else if (ev.type === 'detail') {
        steps.push({ type: 'detail', label: ev.label, value: ev.value, key: stepKey++ });
      } else if (ev.type === 'raw') {
        steps.push({ type: 'raw', message: ev.message, key: stepKey++ });
      } else if (ev.type === 'progress') {
        progressById[ev.id] = { current: ev.current, total: ev.total, label: ev.label };
      } else if (ev.type === 'summary') {
        lastSummary = ev.stats;
      }
    });

    const progressEntries = Object.entries(progressById);
    const hasProgress = progressEntries.length > 0;

    return e(Box, { flexDirection: 'column' },
      currentStepLabel && !lastError ? e(SpinnerWithLabel, { key: 'spinner', label: currentStepLabel }) : null,
      steps.length > 0 ? e(Box, { key: 'steps', flexDirection: 'column', marginTop: 1 }, ...steps.map((s) => {
        if (s.type === 'step') return e(Text, { key: s.key, color: 'cyan' }, '→ ' + s.label + (s.detail ? ' ' + s.detail : ''));
        if (s.type === 'header') return e(Text, { key: s.key, bold: true, color: 'cyan' }, s.text);
        if (s.type === 'dim') return e(Text, { key: s.key, color: 'gray' }, s.message);
        if (s.type === 'ok') return e(Text, { key: s.key, color: 'green' }, '✓ ' + s.message);
        if (s.type === 'fail') return e(Text, { key: s.key, color: 'red' }, '✗ ' + s.message);
        if (s.type === 'warn') return e(Text, { key: s.key, color: 'yellow' }, '⚠ ' + s.message);
        if (s.type === 'info') return e(Text, { key: s.key, color: 'cyan' }, 'info ' + s.message);
        if (s.type === 'detail') return e(Text, { key: s.key, color: 'gray' }, '  • ' + s.label + ': ' + s.value);
        if (s.type === 'raw') return e(Text, { key: s.key }, s.message);
        return null;
      })) : null,
      hasProgress ? e(Box, { key: 'progress', flexDirection: 'column', marginTop: 1 }, ...progressEntries.map(([id, p]) => e(ProgressBar, { key: id, current: p.current, total: p.total, label: p.label }))) : null,
      lastSummary ? e(Box, { key: 'summary', marginTop: 1 }, e(SummaryView, { stats: lastSummary })) : null,
      lastError ? e(Box, { key: 'err', marginTop: 1 }, e(ErrorMessage, { message: lastError })) : null
    );
  }

  return CliRoot;
}

module.exports = {
  createCliRoot,
  e,
};
