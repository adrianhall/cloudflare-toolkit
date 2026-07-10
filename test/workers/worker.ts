// Inert stub Worker entry point.
//
// Exists only so `wrangler.jsonc`'s `main` field resolves to a real file,
// letting @cloudflare/vitest-pool-workers boot workerd (docs/SPECv2.md §7.2).
// No test in this project exercises this handler — hono/* tests wire their
// own bare `Hono` instances directly in the test file, exactly as a real
// consumer would (docs/SPECv2.md §7.4), rather than going through this stub.
export default {
  fetch() {
    return new Response("ok");
  }
};
