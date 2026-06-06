#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { loadLocalEnvFile } from "./env-file.js";
import { createSigilServer } from "./server.js";

async function main() {
  loadLocalEnvFile();
  const config = loadConfig();
  const server = createSigilServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
