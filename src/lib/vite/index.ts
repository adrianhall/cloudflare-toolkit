/**
 * @file Public entry point for the `vite` subpath: `cloudflareAccessPlugin` and its options
 * type.
 *
 * Not re-exported from the root barrel (`src/index.ts`) since importing this subpath pulls in
 * `vite` as a peer dependency.
 */
export { cloudflareAccessPlugin } from "./plugin.js";
export type { CloudflareAccessPluginOptions } from "./plugin.js";
