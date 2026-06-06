import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const distDir = join(root, "dist");
const frontendProjectDir = join(root, "mainspring-front", "project");
const docsDistDir = join(root, "docs-site", "docs", ".vitepress", "dist");
const docsTempDir = join(root, "docs-site", "docs", ".vitepress", ".temp");
const withDocs = process.argv.includes("--with-docs");

function runDocsBuild() {
  rmSync(docsDistDir, { recursive: true, force: true });
  rmSync(docsTempDir, { recursive: true, force: true });
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmBin, ["run", "build", "--prefix", "docs-site"], {
    cwd: root,
    env: { ...process.env, MAINSPRING_DOCS_BASE: "/docs/" },
    shell: process.platform === "win32",
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(frontendProjectDir)) {
  throw new Error(`Missing copied frontend project at ${frontendProjectDir}`);
}

if (withDocs) {
  runDocsBuild();
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(frontendProjectDir, distDir, { recursive: true });

if (existsSync(docsDistDir)) {
  cpSync(docsDistDir, join(distDir, "docs"), { recursive: true });
}

console.log(`Built public site into ${distDir}`);
