import { cors } from "hono/cors";
import { config } from "../config.js";

// Allow-list the configured WEB_URL only. Returning `undefined` from the
// origin callback makes `hono/cors` omit the Access-Control-Allow-Origin
// header entirely, which browsers treat as "origin not allowed" — this is
// what the acceptance criterion for rejected origins checks.
export const corsMiddleware = () =>
  cors({
    origin: (origin) => (origin === config.webUrl ? origin : undefined),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
