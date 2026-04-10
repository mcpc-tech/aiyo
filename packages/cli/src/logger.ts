import pino from "pino";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

// Log dir: ~/.aiyo/logs/  or  AIYO_LOG_DIR env
const logDir = process.env.AIYO_LOG_DIR ?? join(homedir(), ".aiyo", "logs");
mkdirSync(logDir, { recursive: true });

const logFile = join(logDir, `aiyo-${new Date().toISOString().slice(0, 10)}.log`);

export const logger = pino(
  {
    level: process.env.AIYO_LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    // Human-readable to stderr
    {
      stream: pino.transport({
        target: "pino-pretty",
        options: { colorize: true, sync: true, destination: 2 },
      }),
      level: "info",
    },
    // NDJSON to file (all levels)
    {
      stream: pino.destination({ dest: logFile, sync: false }),
      level: "debug",
    },
  ]),
);

export { logFile };
