const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number.parseInt(required("API_PORT", "3001"), 10),
  host: required("API_HOST", "0.0.0.0"),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
