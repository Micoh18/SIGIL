import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  discoverCasperClient,
  parseWslQuietList,
  parseWslVerboseList
} from "../src/casper/clientDiscovery.js";

type SpawnResult = ReturnType<typeof spawnSync>;

describe("Casper client discovery", () => {
  it("parses quiet and verbose WSL distro output", () => {
    expect(parseWslQuietList("docker-desktop\r\nUbuntu\r\n")).toEqual([
      "docker-desktop",
      "Ubuntu"
    ]);
    expect(
      parseWslVerboseList(
        "  NAME                   STATE           VERSION\r\n" +
          "* docker-desktop        Stopped         2\r\n" +
          "  Ubuntu                Running         2\r\n"
      )
    ).toEqual(["docker-desktop", "Ubuntu"]);
  });

  it("auto-discovers casper-client inside WSL and resolves the absolute Linux path", () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawn = ((command: string, args: readonly string[] = []) => {
      calls.push({ command, args });

      if (command === "casper-client") {
        return result(1);
      }

      if (args.join("\0") === "--list\0--quiet") {
        return result(0, Buffer.from("docker-desktop\r\nUbuntu\r\n", "utf16le"));
      }

      if (args.join("\0") === "-d\0docker-desktop\0--\0sh\0-lc\0command -v 'casper-client'") {
        return result(1);
      }

      if (args.join("\0") === "-d\0Ubuntu\0--\0sh\0-lc\0command -v 'casper-client'") {
        return result(0, "/home/me/.cargo/bin/casper-client\n");
      }

      if (
        args.join("\0") ===
        "-d\0Ubuntu\0--\0/home/me/.cargo/bin/casper-client\0--version"
      ) {
        return result(0, "Casper client 5.0.1\n");
      }

      return result(1);
    }) as typeof spawnSync;

    const discovered = discoverCasperClient({ platform: "win32", spawn });

    expect(discovered).toMatchObject({
      clientBin: "/home/me/.cargo/bin/casper-client",
      clientWslDistro: "Ubuntu",
      found: true
    });
    expect(calls.map(call => call.args.join(" "))).toContain(
      "-d Ubuntu -- /home/me/.cargo/bin/casper-client --version"
    );
  });

  it("uses an explicitly configured WSL distro before native probing", () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawn = ((command: string, args: readonly string[] = []) => {
      calls.push({ command, args });

      if (args.join("\0") === "-d\0Debian\0--\0sh\0-lc\0command -v 'casper-client'") {
        return result(0, "/home/me/.cargo/bin/casper-client\n");
      }

      if (
        args.join("\0") ===
        "-d\0Debian\0--\0/home/me/.cargo/bin/casper-client\0--version"
      ) {
        return result(0, "Casper client 5.0.1\n");
      }

      return result(1);
    }) as typeof spawnSync;

    const discovered = discoverCasperClient({
      platform: "win32",
      clientWslDistro: "Debian",
      spawn
    });

    expect(discovered.clientWslDistro).toBe("Debian");
    expect(calls.some(call => call.command === "casper-client")).toBe(false);
  });
});

function result(status: number, stdout: string | Buffer = ""): SpawnResult {
  return {
    status,
    signal: null,
    output: [],
    pid: 0,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr: Buffer.alloc(0)
  };
}
