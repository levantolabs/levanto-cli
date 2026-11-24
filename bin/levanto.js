#!/usr/bin/env node
import { run } from '../src/cli.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`levanto needs Node.js 18 or newer (this is ${process.versions.node}).`);
  process.exit(1);
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`✗ ${e?.message ?? e}`);
    process.exitCode = 1;
  },
);
