const React = require('react');
const { render, Text, Box } = require('ink');
const Spinner = require('ink-spinner').default || require('ink-spinner');

const e = React.createElement;

function StatusLine({ label, value, color }) {
  return e(Box, null,
    e(Text, { bold: true }, label + ': '),
    e(Text, { color: color || 'white' }, value)
  );
}

function ErrorMessage({ message }) {
  return e(Text, { color: 'red' }, message);
}

function SuccessMessage({ message }) {
  return e(Text, { color: 'green' }, message);
}

function SpinnerWithLabel({ label }) {
  return e(Box, null,
    e(Text, { color: 'cyan' }, e(Spinner, { type: 'dots' })),
    e(Text, null, ' ' + label)
  );
}

module.exports = { StatusLine, ErrorMessage, SuccessMessage, SpinnerWithLabel, e };
