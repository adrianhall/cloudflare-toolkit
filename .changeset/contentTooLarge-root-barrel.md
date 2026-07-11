---
"@adrianhall/cloudflare-toolkit": patch
---

Add `contentTooLarge` (413) to the framework-agnostic root entry point's re-exports. It was added
to `@adrianhall/cloudflare-toolkit/errors` after the root barrel was originally wired and was
never backfilled — every other error generator was already re-exported from
`@adrianhall/cloudflare-toolkit`.

Also adds the corresponding `contentTooLarge(input?)` | `413` row to `skills/cloudflare-toolkit/SKILL.md`'s
HTTP Errors table, which previously omitted it as well.
