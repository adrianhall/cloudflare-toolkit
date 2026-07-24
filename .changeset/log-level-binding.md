---
"@adrianhall/cloudflare-toolkit": minor
---

`cloudflareLogger` now honors a `LOG_LEVEL` Worker binding (`c.env.LOG_LEVEL`) to set the minimum
log level. It accepts any of the six levels (`trace`/`debug`/`info`/`warn`/`error`/`fatal`,
case-insensitive) and sits below an explicit `options.level` but above the
`resolveLoggerConfig(env.ENVIRONMENT, "worker")` default. A value that is set but unrecognized is
ignored with a `console.warn`, and an unset binding preserves the previous behavior.
