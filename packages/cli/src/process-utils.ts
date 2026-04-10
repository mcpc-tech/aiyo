import { spawnSync } from "node:child_process";

export interface RunInteractiveCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runInteractiveCommand(
  command: string,
  args: string[],
  options: RunInteractiveCommandOptions = {},
): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd,
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw new Error(
      `Failed to start ${command}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
    );
  }

  if (result.signal) {
    throw new Error(`${command} exited with signal ${result.signal}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
  }
}
