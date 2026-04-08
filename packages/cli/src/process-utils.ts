import { spawn } from "node:child_process";

export interface RunInteractiveCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function runInteractiveCommand(
  command: string,
  args: string[],
  options: RunInteractiveCommandOptions = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}
