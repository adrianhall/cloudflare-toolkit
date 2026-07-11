/**
 * @file Public entry point for the `vite` subpath: `cloudflareAccessPlugin` and its options
 * type.
 *
 * Not re-exported from the root barrel (`src/index.ts`) since importing this subpath pulls in
 * `vite` as a peer dependency.
 */
export { cloudflareAccessPlugin } from "./plugin.js";
export type { CloudflareAccessPluginOptions } from "./plugin.js";
// `auth-internal` has no public barrel of its own (per its own file comment) — this re-exports
// just the `PathPolicy` type so `CloudflareAccessPluginOptions.policies` has a linkable API
// Reference page, not the rest of that module's surface.
export type { PathPolicy } from "../auth-internal/types.js";
export type { DevLoginUser } from "./login-page.js";
