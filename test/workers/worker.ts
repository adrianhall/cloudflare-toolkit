// Inert stub Worker entry point.
//
// Exists only so `wrangler.jsonc`'s `main` field resolves to a real file,
// letting @cloudflare/vitest-pool-workers boot workerd (docs/SPECv2.md §7.2).
// No test in this project currently exercises this handler — tests either
// import modules from src/ directly or assert on Workers runtime globals.
// Replace with a real Worker entry once hono/* tests land (see issue #10).
export default {
  fetch() {
    return new Response("ok");
  }
};
