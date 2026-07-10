// Vite plugins barrel (docs/SPECv2.md §5.1, §5.6, §5.9). Deliberately not re-exported from the
// root barrel — see src/index.ts — since importing this subpath pulls in `vite` as a peer
// dependency.
export { cloudflareAccessPlugin } from "./plugin.js";
export type { CloudflareAccessPluginOptions } from "./plugin.js";
