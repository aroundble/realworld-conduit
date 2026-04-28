import { pino } from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label, number) => ({ level: number, levelLabel: label }),
  },
});

export type Logger = typeof logger;
