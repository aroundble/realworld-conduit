const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  port: Number.parseInt(required("API_PORT", "3001"), 10),
  host: required("API_HOST", "0.0.0.0"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  webUrl: required("WEB_URL", "http://localhost:3000"),
  jwtSecret: required("JWT_SECRET", nodeEnv === "production" ? undefined : "dev-only-jwt-secret-do-not-use-in-prod"),
  jwtTtlSeconds: Number.parseInt(process.env.JWT_TTL_SECONDS ?? "604800", 10),
  jwtClockSkewSeconds: Number.parseInt(process.env.JWT_CLOCK_SKEW_SECONDS ?? "5", 10),
  bcryptCost: Number.parseInt(process.env.BCRYPT_COST ?? "10", 10),
  cookieDomain: process.env.COOKIE_DOMAIN ?? "localhost",
  cookieSecure: (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true",
  articleListDefaultLimit: Number.parseInt(process.env.ARTICLE_LIST_DEFAULT_LIMIT ?? "20", 10),
  articleListMaxLimit: Number.parseInt(process.env.ARTICLE_LIST_MAX_LIMIT ?? "100", 10),
} as const;
