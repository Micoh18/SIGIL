import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function mapCasperClientSecretKeyArgs(
  args: string[],
  clientWslDistro: string | null
): string[] {
  if (!clientWslDistro) {
    return args;
  }

  return args.map((arg, index) =>
    args[index - 1] === "--secret-key" ? toWslPath(resolveCasperClientPath(arg)) : arg
  );
}

function resolveCasperClientPath(value: string): string {
  if (value.startsWith("/")) {
    return value;
  }

  return isAbsolute(value) ? value : resolve(repoRoot(), value);
}

function repoRoot(): string {
  const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));

  return dirname(backendRoot);
}

function toWslPath(value: string): string {
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) {
    return value.replaceAll("\\", "/");
  }

  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
}
