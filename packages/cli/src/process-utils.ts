import { spawn, spawnSync } from "node:child_process";

export interface RunInteractiveCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a TUI command in the foreground while keeping an async event loop alive.
 * Uses async spawn (not spawnSync) so the Node.js HTTP server can keep serving.
 * The returned promise resolves when the command exits.
 */
export function runInteractiveCommand(
  command: string,
  args: string[],
  options: RunInteractiveCommandOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
      env: options.env ?? process.env,
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start ${command}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(); // treat signal exit as clean
        return;
      }
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}
