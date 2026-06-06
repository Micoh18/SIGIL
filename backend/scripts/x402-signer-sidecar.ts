import { once } from "node:events";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createX402SignerHttpServer,
  loadCasperSigningKeyFromFile
} from "../src/x402/signer.js";

const host = optionalEnv(process.env.X402_SIGNER_HOST) ?? "127.0.0.1";
const port = parsePort(process.env.X402_SIGNER_PORT, 4030);
const privateKeyPath = requiredEnv(
  "X402_BUYER_PRIVATE_KEY_PATH",
  process.env.X402_BUYER_PRIVATE_KEY_PATH
);
const buyerAccountHash = requiredEnv(
  "X402_BUYER_ACCOUNT_HASH",
  process.env.X402_BUYER_ACCOUNT_HASH
);

assertPrivateKeyOutsideRepo(privateKeyPath);

const signingKey = loadCasperSigningKeyFromFile(privateKeyPath);
const server = createX402SignerHttpServer({
  signingKey,
  buyerAccountHash,
  authToken: optionalEnv(process.env.X402_SIGNER_AUTH_TOKEN),
  maxValiditySeconds: parsePositiveInteger(
    process.env.X402_SIGNER_MAX_VALIDITY_SECONDS,
    900
  ),
  logger: console
});

server.listen(port, host);
await once(server, "listening");

const address = server.address();
if (typeof address === "object" && address) {
  console.log(`x402 signer sidecar: http://${address.address}:${address.port}/sign`);
} else {
  console.log(`x402 signer sidecar: http://${host}:${port}/sign`);
}
console.log(`x402 signer key: ${signingKey.algorithm} public_key=${signingKey.publicKey}`);
console.log("Press Ctrl+C to stop.");

function assertPrivateKeyOutsideRepo(path: string): void {
  const keyPath = realpathSync(resolve(path));
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const relativePath = relative(repoRoot, keyPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new Error(
      "X402_BUYER_PRIVATE_KEY_PATH must point outside the repository workspace"
    );
  }
}

function requiredEnv(name: string, value: string | undefined): string {
  const normalized = optionalEnv(value);
  if (!normalized) {
    throw new Error(`${name} is required for the x402 signer sidecar`);
  }

  return normalized;
}

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parsePort(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid X402_SIGNER_PORT: ${normalized}`);
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid X402_SIGNER_MAX_VALIDITY_SECONDS: ${normalized}`);
  }

  return parsed;
}
