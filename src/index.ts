#!/usr/bin/env bun
// Redirect all console output to stderr so ACP JSON-RPC on stdout stays clean
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error("Geon v0.1.11");
  process.exit(0);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error("Geon - Multi-provider ACP agent");
  console.error("Usage: geon [options]");
  console.error("Options:");
  console.error("  --version, -v  Show version");
  console.error("  --help, -h     Show help");
  process.exit(0);
}

import { runAcp } from "./acp/server.js";
runAcp();
