// Inert stub Worker entry point, used only so `wrangler.jsonc`'s `main` field resolves to a
// real file so @cloudflare/vitest-pool-workers can boot workerd.
export default {
  fetch() {
    return new Response("ok");
  }
};
