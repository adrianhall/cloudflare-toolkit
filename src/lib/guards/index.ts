// Guards barrel (docs/SPECv2.md §5.1, §5.2): throwIfNull, valueOrDefault, sqlCount.
// Depends only on `errors` (for NullError) — never the reverse.
export { sqlCount, throwIfNull, valueOrDefault } from "./guards.js";
