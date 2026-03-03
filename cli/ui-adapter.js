const logFormatters = require('./log');
const { c, SYM, formatStep, formatInfo, formatWarn, formatFail, formatOk, formatDetail, formatSummary, formatTiming, formatProgressLine, formatHeader, formatDim, formatAdded, formatRemoved } = logFormatters;
const { cid: fmtCid, name: fmtName, url: fmtUrl, tag: fmtTag } = logFormatters;

function createConsoleAdapter() {
  const progressState = {};

  return {
    step(label, detail) {
      console.log(formatStep(label, detail));
    },
    info(message) {
      console.log(formatInfo(message));
    },
    warn(message) {
      console.log(formatWarn(message));
    },
    fail(message) {
      console.error(formatFail(message));
    },
    ok(message) {
      console.log(formatOk(message));
    },
    detail(label, value) {
      console.log(formatDetail(label, value));
    },
    summary(stats) {
      console.log('');
      console.log(formatSummary(stats));
    },
    timing(label, ms) {
      console.log(formatTiming(label, ms));
    },
    header(text) {
      console.log('');
      console.log(formatHeader(text));
    },
    dim(...args) {
      console.log(formatDim(args.join(' ')));
    },
    added(nameStr) {
      console.log(formatAdded(nameStr));
    },
    removed(nameStr) {
      console.log(formatRemoved(nameStr));
    },
    progress(id, current, total, label) {
      const line = formatProgressLine(current, total, label);
      progressState[id] = { current, total, label };
      process.stdout.write(`\r${line}`);
      if (current >= total) {
        process.stdout.write('\n');
      }
    },
    raw(message) {
      console.log(message);
    },
    cid: (s) => fmtCid(s),
    name: (s) => fmtName(s),
    url: (s) => fmtUrl(s),
    tag: (s) => fmtTag(s),
    c,
    SYM,
  };
}

function createInkAdapter(eventSink) {
  const emit = (event) => {
    if (typeof eventSink === 'function') eventSink(event);
  };

  return {
    step(label, detail) {
      emit({ type: 'step', label, detail: detail || null });
    },
    info(message) {
      emit({ type: 'info', message });
    },
    warn(message) {
      emit({ type: 'warn', message });
    },
    fail(message) {
      emit({ type: 'fail', message });
    },
    ok(message) {
      emit({ type: 'ok', message });
    },
    detail(label, value) {
      emit({ type: 'detail', label, value });
    },
    summary(stats) {
      emit({ type: 'summary', stats });
    },
    timing(label, ms) {
      emit({ type: 'timing', label, ms });
    },
    header(text) {
      emit({ type: 'header', text });
    },
    dim(...args) {
      emit({ type: 'dim', message: args.join(' ') });
    },
    added(nameStr) {
      emit({ type: 'ok', message: nameStr });
    },
    removed(nameStr) {
      emit({ type: 'removed', message: nameStr });
    },
    progress(id, current, total, label) {
      emit({ type: 'progress', id, current, total, label });
    },
    raw(message) {
      emit({ type: 'raw', message });
    },
    cid: (s) => String(s),
    name: (s) => String(s),
    url: (s) => String(s),
    tag: (s) => String(s),
    c: logFormatters.c,
    SYM: logFormatters.SYM,
  };
}

function createUi(mode, eventSink) {
  if (mode === 'ink') return createInkAdapter(eventSink);
  return createConsoleAdapter();
}

module.exports = {
  createUi,
  createConsoleAdapter,
  createInkAdapter,
};

