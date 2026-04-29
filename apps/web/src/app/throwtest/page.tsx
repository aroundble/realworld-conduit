// Test-only throw page (#147). Lets Playwright exercise the
// root-segment error.tsx boundary without having to intercept
// server-side RSC fetches.
//
// Guarded by the dedicated `CONDUIT_ENABLE_THROW_TEST` env var
// rather than NODE_ENV — Next.js's `next start` forces
// NODE_ENV=production at runtime regardless of what compose
// passes, so a NODE_ENV-based gate wouldn't let dev/test stacks
// opt in. The flag is set to "1" in compose.yml for non-prod
// deploys and left unset in real production.

const THROW_ENABLED = process.env.CONDUIT_ENABLE_THROW_TEST === "1";

export default function ThrowPage() {
  if (!THROW_ENABLED) {
    return (
      <div className="container" style={{ padding: "3rem 1rem" }}>
        <p>Test-only route; disabled in production.</p>
      </div>
    );
  }
  throw new Error("boom — deliberate test failure from /throwtest");
}
