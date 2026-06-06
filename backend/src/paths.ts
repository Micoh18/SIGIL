import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export type MainspringPaths = {
  appDir: string;
  envFile: string;
  dataDir: string;
  logsDir: string;
};

export function getDefaultMainspringPaths(
  env: NodeJS.ProcessEnv = process.env,
  platformName = platform(),
  homeDir = homedir()
): MainspringPaths {
  const appDir = resolve(getDefaultAppDir(env, platformName, homeDir));

  return {
    appDir,
    envFile: join(appDir, ".env"),
    dataDir: join(appDir, "data"),
    logsDir: join(appDir, "logs")
  };
}

function getDefaultAppDir(
  env: NodeJS.ProcessEnv,
  platformName: string,
  homeDir: string
): string {
  if (platformName === "win32") {
    return join(env.APPDATA?.trim() || join(homeDir, "AppData", "Roaming"), "MrMainspring");
  }

  if (platformName === "darwin") {
    return join(homeDir, "Library", "Application Support", "MrMainspring");
  }

  return join(env.XDG_CONFIG_HOME?.trim() || join(homeDir, ".config"), "mrmainspring");
}
