import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lastVerified, toolSchemas } from "../content/tool-schemas.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDir = join(root, "docs");
const publicDir = join(docsDir, "public");
const schemaPath = join(publicDir, "api", "tool-schemas.json");
const pageOrder = [
  "index.md",
  "quickstart.md",
  "architecture.md",
  "mcp-tools.md",
  "memory.md",
  "grimoire.md",
  "payments-x402.md",
  "casper-x402-runbook.md",
  "casper-anchoring.md",
  "audit-trail.md",
  "security-model.md",
  "local-demo.md",
  "api-schema-reference.md",
  "current-limitations.md"
];

const pages = await loadPages();
await mkdir(dirname(schemaPath), { recursive: true });
await writeFile(
  schemaPath,
  `${JSON.stringify({ generated_at: lastVerified, last_verified: lastVerified, tools: toolSchemas }, null, 2)}\n`,
  "utf8"
);
await writeFile(join(publicDir, "llms.txt"), renderLlmsTxt(pages), "utf8");
await writeFile(join(publicDir, "llms-full.txt"), renderLlmsFull(pages), "utf8");

async function loadPages() {
  const files = await collectMarkdown(docsDir);
  const ordered = files.sort((a, b) => {
    const aKey = relative(docsDir, a).split(sep).join("/");
    const bKey = relative(docsDir, b).split(sep).join("/");
    const orderDifference = orderIndex(aKey) - orderIndex(bKey);
    return orderDifference === 0 ? aKey.localeCompare(bKey) : orderDifference;
  });

  return Promise.all(
    ordered.map(async (file) => {
      const raw = await readFile(file, "utf8");
      const { frontmatter, body } = parseFrontmatter(raw);
      const route = routeFor(file);
      return {
        file: relative(root, file).split(sep).join("/"),
        route,
        title: frontmatter.title ?? titleFromFile(file),
        description: frontmatter.description ?? "",
        section: frontmatter.section ?? "Guide",
        status: frontmatter.status ?? "draft",
        last_verified: frontmatter.last_verified ?? lastVerified,
        body: stripInternalComments(body).trim()
      };
    })
  );
}

async function collectMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".vitepress" || entry.name === "public") {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdown(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    frontmatter[key] = value;
  }

  return { frontmatter, body: raw.slice(match[0].length) };
}

function routeFor(file) {
  const relativePath = relative(docsDir, file).split(sep).join("/");
  if (relativePath === "index.md") {
    return "/";
  }

  return `/${relativePath.replace(/\.md$/, "")}`;
}

function renderLlmsTxt(pages) {
  const implementedTools = toolSchemas
    .filter((tool) => tool.status === "implemented")
    .map((tool) => tool.name)
    .join(", ");
  const settlementReadyTools = toolSchemas
    .filter((tool) => tool.status === "settlement-ready")
    .map((tool) => tool.name)
    .join(", ");

  const lines = [
    "# Mr Mainspring",
    "",
    "> Mr Mainspring is an MCP backend for agent memory, Grimoire policies/secrets, Casper anchoring, and x402 payment flows.",
    "",
    `Last verified: ${lastVerified}`,
    "",
    "## Current Real Capabilities",
    "",
    `- Implemented MCP tools: ${implementedTools}.`,
    `- Settlement-ready MCP tools: ${settlementReadyTools}.`,
    "- Local JSON-file stores are used under the user's Mr Mainspring app data directory by default; SIGIL_DATA_DIR can override it.",
    "- Optional Supabase persistence is available after applying backend/supabase/schema.sql and setting SIGIL_STORAGE_BACKEND=supabase with PROJECT_URL plus SECRET_KEY or PUBLISHABLE_KEY.",
    "- Memory records are canonicalized and verified with SHA-256 hashes.",
    "- Grimoire secrets are encrypted locally and returned as metadata only.",
    "- payment.fetch can policy-check, persist an intent, capture the first HTTP 402 challenge, and when configured call an external signer sidecar before retrying the paid resource with PAYMENT-SIGNATURE.",
    "- The Casper x402 runbook documents the native CSPR testnet path with signer/resource/facilitator sidecars, payment.fetch smoke output, and transaction hash verification.",
    "",
    "## Verify Locally",
    "",
    "- Regenerate LLM docs: `npm.cmd run docs:llms --prefix docs-site`.",
    "- Build docs: `npm.cmd run build --prefix docs-site`.",
    "- Preview docs: `npm.cmd run preview --prefix docs-site -- --port 4176`.",
    "- Check generated routes/files: `/llms.txt`, `/llms-full.txt`, and `/api/tool-schemas.json`.",
    "- Verify backend: `npm test --prefix backend` and `npm run build --prefix backend`.",
    "",
    "## Canonical Docs",
    ""
  ];

  for (const page of pages) {
    lines.push(`- [${page.title}](${page.route}): ${page.description} Status: ${page.status}.`);
  }

  lines.push(
    "",
    "## Machine-Readable References",
    "",
    "- [Full single-file docs](/llms-full.txt)",
    "- [MCP tool schemas](/api/tool-schemas.json)",
    "",
    "## Critical Current Limits",
    "",
    "- Real Casper x402 settlement is disabled by default and must be verified through the Casper x402 runbook before it is claimed.",
    "- Real x402 settlement requires X402_ENABLE_REAL_SETTLEMENT=true, X402_SIGNER_URL, and a resource/facilitator path that returns a verifiable PAYMENT-RESPONSE.",
    "- The memory-anchor contract is deployed and anchor submission has been smoke-tested, but backend memory-anchor finality/query verification is not complete.",
    "- Supabase persistence is a JSONB bridge, not the final normalized production database schema.",
    "- Remote HTTP MCP transport, production database migrations, and KMS/HSM integrations are not implemented."
  );

  return `${lines.join("\n")}\n`;
}

function renderLlmsFull(pages) {
  const lines = [
    "# Mr Mainspring Full LLM Docs",
    "",
    `Last verified: ${lastVerified}`,
    "",
    "This file is generated from the VitePress Markdown docs plus the MCP tool schema data.",
    ""
  ];

  for (const page of pages) {
    lines.push(
      `# ${page.title}`,
      "",
      `Source: ${page.file}`,
      `Canonical path: ${page.route}`,
      `Description: ${page.description}`,
      `Section: ${page.section}`,
      `Status: ${page.status}`,
      `Last verified: ${page.last_verified}`,
      "",
      page.body,
      ""
    );
  }

  lines.push(
    "# MCP Tool Schemas",
    "",
    "```json",
    JSON.stringify(toolSchemas, null, 2),
    "```",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function orderIndex(key) {
  const index = pageOrder.indexOf(key);
  return index >= 0 ? index : pageOrder.length;
}

function titleFromFile(file) {
  return basename(file, ".md")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripInternalComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "");
}
