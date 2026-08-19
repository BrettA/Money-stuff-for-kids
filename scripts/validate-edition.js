#!/usr/bin/env node
const path = require('path');
const { loadInputs, validate } = require('./publish');

try {
  const root = path.resolve(process.argv[2]);
  const { config, editions } = loadInputs(root);
  const errors = validate(config, editions, root);
  if (editions.length !== 1) errors.push('ingestion staging area must contain exactly one edition');
  if (errors.length) throw new Error(errors.map(error => `• ${error}`).join('\n'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
