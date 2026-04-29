// Web's liveness probe is deliberately cheap: a static 200 `{ok:true}`
// with no DB or upstream-API check. Container orchestrators need
// "is the Next.js server answering?" — an unhealthy upstream API
// does not mean the Next.js process is down. AC spec: #25.

export const GET = async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
