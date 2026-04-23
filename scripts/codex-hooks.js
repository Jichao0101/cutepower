#!/usr/bin/env node
'use strict';

const { runCli } = require('./codex-host-adapter');

if (require.main === module) {
  process.exitCode = runCli(process.argv[2]);
}
