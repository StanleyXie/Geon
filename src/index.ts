#!/usr/bin/env bun
// Redirect all console output to stderr so ACP JSON-RPC on stdout stays clean
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

import { runAcp } from "./acp/server.js";
runAcp();
process.stdin.resume();
