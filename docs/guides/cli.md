# The `generate-wrangler-types` CLI

Wrangler can generate a `worker-configuration.d.ts` file describing your bindings
(`wrangler types`), but nothing regenerates it automatically as `wrangler.jsonc` changes.
`generate-wrangler-types` — installed as this package's `bin` — wraps that command with a cheap
freshness check, so you can run it on every build without wastefully re-invoking `wrangler` when
nothing changed.

## How the freshness check works

Before running `wrangler types`, the CLI compares the **file modification time** of your output
`.d.ts` file against your wrangler config file:

- If the output file doesn't exist yet, it generates it.
- If the config file is newer than the output file, it regenerates.
- If the output file is newer than the config file, it skips regeneration entirely (exit code
  `0`) — this is the common case on most builds, where `wrangler.jsonc` hasn't changed since the
  last run.
- `--force` skips this comparison and always regenerates.

This is a plain mtime comparison, not a content hash — touching `wrangler.jsonc` without
changing its content (e.g. `touch wrangler.jsonc`) is enough to trigger a regeneration on the
next run.

## Wiring it into your build

```jsonc
// package.json
{
  "scripts": {
    "prebuild": "generate-wrangler-types",
    "build": "vite build"
  }
}
```

Because `npm run build` runs `prebuild` first automatically, and the freshness check makes an
unnecessary run essentially free, this is safe to leave wired into every build — local dev
builds, CI, and deploys — without a separate "did the config change?" step of your own.

## Flags

| Flag            | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `-c, --config`  | Wrangler config file to watch (default `wrangler.jsonc`)                        |
| `-d, --dir`     | Base directory for resolving relative `--config`/`--output` paths (default `.`) |
| `-f, --force`   | Force regeneration even if types are already fresh                              |
| `-o, --output`  | Output `.d.ts` path, relative to `--dir` (default `worker-configuration.d.ts`)  |
| `-q, --quiet`   | Quiet logging (minimum level `warn`)                                            |
| `-v, --verbose` | Verbose logging (minimum level `debug`)                                         |
| `--`            | Everything after this separator is forwarded verbatim to `wrangler types`       |

`-v` and `-q` are mutually exclusive — passing both is an argument error (exit code `6`, see
below), not a silent "last one wins."

```sh
# Force regeneration even though the output looks fresh.
generate-wrangler-types --force

# A staging config that writes its types somewhere other than the default location.
generate-wrangler-types -c wrangler.staging.jsonc -o types/worker-configuration.d.ts

# Forward an extra flag straight through to `wrangler types` itself.
generate-wrangler-types -- --strict-vars=false
```

### Multiple environments

If your project has more than one Wrangler config (e.g. one per environment), give each its own
npm script rather than trying to make a single invocation cover both — each `-c`/`-o` pair is
independent:

```jsonc
// package.json
{
  "scripts": {
    "generate-types": "generate-wrangler-types",
    "generate-types:staging": "generate-wrangler-types -c wrangler.staging.jsonc -o types/staging-configuration.d.ts"
  }
}
```

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Types are already fresh (skipped), or `wrangler types` completed successfully |
| `1`  | Wrangler config file not found                                                |
| `2`  | The `wrangler` binary could not be executed (not on `PATH`, `ENOENT`, ...)    |
| `3`  | `wrangler types` itself exited with a non-zero code (that code is logged)     |
| `6`  | Argument error — e.g. `--verbose` and `--quiet` passed together               |
| `99` | Unexpected internal error                                                     |

A non-zero exit code fails the `prebuild` step (and therefore `npm run build`), so a genuinely
broken `wrangler.jsonc` or missing `wrangler` binary stops the build rather than silently
shipping stale binding types.

## See also

- [Getting Started](/getting-started) — wiring this CLI into a from-scratch project alongside
  the rest of the toolkit.
