# `empty-r2-bucket` Implementation Plan

Issue: [#168](https://github.com/adrianhall/cloudflare-toolkit/issues/168)

## Goal

Add an `empty-r2-bucket` package binary that safely empties one remote or local R2 bucket before
infrastructure teardown. The command must determine whether the bucket is non-empty before
prompting, fail closed when discovery is incomplete, support non-interactive automation, and
return stable exit codes. An exact object count is not required.

Importantly, this command MUST succeed on a remote R2 bucket with only "Workers R2 Storage Write"
permissions. Any solution that requires an S3 compatible access key ID / secret access key set
is not a permissible solution. The production implementation must use the Cloudflare REST API
with a bearer token and must not depend on the S3-compatible API or AWS Signature Version 4.

## Existing CLI Conventions

The implementation must follow the contracts already established by `generate-wrangler`,
`generate-wrangler-types`, and `destroy-containers`:

- Use Commander, reject unknown options, and return `0` after printing `--help` or `--version`.
- Put orchestration in an injected, directly testable `run(argv, deps)` function. Keep the
  executable `index.ts` as a thin shebang entry point that calls `process.exit()` with the result.
- Use the private CLI logger with the standard `-q, --quiet` and `-v, --verbose` flags. Treat the
  two flags as mutually exclusive and return exit `6` if both are supplied.
- Use `--env-file <path>` for dotenv loading. Existing process environment values take precedence
  over values loaded from the file.
- Use `-y, --yes` to bypass a destructive confirmation. `--force` has a different meaning in the
  existing non-destructive generation commands and must not be reused for confirmation bypass.
- Prefer credentials from environment variables or `--env-file`. Keep direct credential flags as
  discouraged compatibility options because command-line secrets can leak through shell history
  and process listings.
- Return `0` when there is nothing to do, as well as after successful work. Return `1` when the
  operator declines an otherwise valid destructive operation.
- Reserve exit `6` for command-line usage errors and exit `99` for unexpected internal failures.
  Expected filesystem, Terraform, credential, and API failures receive specific lower exit codes.
- Emit progress and errors through the CLI logger, but print the destructive summary and prompt in
  a form suitable for an interactive terminal.

The issue's provisional `--env` and `--force` examples are therefore normalized to
`--env-file` and `--yes`.

## Proposed Command

```text
empty-r2-bucket [options] [bucket-name]
```

`bucket-name` is required in standalone remote and local modes. It is omitted in Terraform mode,
where the bucket name is read from the `r2_bucket_name` output.

| Flag                      | Meaning                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `-a, --account-id <id>`   | Cloudflare account ID; prefer `CLOUDFLARE_ACCOUNT_ID`                                  |
| `-k, --api-token <token>` | Cloudflare API token; prefer `CLOUDFLARE_API_TOKEN` or `--env-file`                    |
| `--env-file <path>`       | Load dotenv defaults before resolving remote credentials                               |
| `-t, --terraform <dir>`   | Read `account_id` and `r2_bucket_name` from `terraform output -json` in this directory |
| `--local`                 | Use the Miniflare Local Explorer API at its default local URL                          |
| `--local-url <url>`       | Override the Local Explorer API URL; valid only with `--local`                         |
| `-y, --yes`               | Skip the destructive confirmation prompt                                               |
| `-q, --quiet`             | Emit warnings and errors only                                                          |
| `-v, --verbose`           | Emit debug logs                                                                        |
| `--version`               | Print the package version and exit                                                     |

Argument rules:

- `--terraform` and a positional `bucket-name` are mutually exclusive.
- `--local` requires a positional `bucket-name` and is mutually exclusive with `--terraform`,
  `--account-id`, `--api-token`, and `--env-file`.
- `--local-url` requires `--local`; without an override, local mode uses
  `http://localhost:5173/cdn-cgi/explorer/api`.
- Remote standalone mode requires a positional `bucket-name`, an account ID, and an API token.
- Terraform mode requires string outputs named `account_id` and `r2_bucket_name`, plus an API
  token from `CLOUDFLARE_API_TOKEN`, `--env-file`, or the discouraged `--api-token` option.
- Local mode requires no Cloudflare credentials. The supplied URL is the local explorer API base,
  including `/cdn-cgi/explorer/api`.

## Valid CLI Examples

### Standalone Remote Bucket

Load `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from `.env`, check whether
`application-exports` contains objects, and prompt before deleting them:

```sh
empty-r2-bucket application-exports --env-file .env
```

For an intentional non-interactive cleanup:

```sh
empty-r2-bucket application-exports --env-file .env --yes
```

### Terraform-Provisioned Bucket

Read `account_id` and `r2_bucket_name` from the Terraform state in `infra/`, load the API token
from `.env`, and skip the prompt for a preteardown script:

```sh
empty-r2-bucket --terraform infra --env-file .env --yes
```

The corresponding scalar Terraform outputs are:

```hcl
output "account_id" {
  value = local.account_id
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.exports.name
}
```

The Cloudflare API token remains in `.env`; it is not copied into a Terraform output.

### Local Miniflare Bucket

Empty the local `application-exports` bucket through the local explorer endpoint exposed by a
running Wrangler or Vite development server:

```sh
empty-r2-bucket application-exports --local
```

The development server must already be running, and its R2 binding must use
`application-exports` as the bucket name. Local mode defaults to Vite's standard port `5173`.
Wrangler's standard port `8787`, Vite's automatic next-port selection, or any other non-default
host, port, or scheme must be reflected in the `--local-url` override:

```sh
empty-r2-bucket application-exports --local --local-url http://localhost:8787/cdn-cgi/explorer/api
```

> **QUESTION:** Can we avoid `--local-url` by instead referencing the local `.wrangler` directory?
>
> **ANSWER:** Do not read or mutate `.wrangler/state` directly. Cloudflare documents that the
> directory can be removed to reset local state, but the bucket-specific layout is an internal
> implementation detail, the persistence root can be changed with Wrangler's `--persist-to` or
> Vite's `persistState`, and direct deletion can conflict with a running Miniflare process. Use the
> supported Local Explorer API instead. `--local` avoids requiring a URL for the common case by
> defaulting to `http://localhost:5173/cdn-cgi/explorer/api`; `--local-url` remains available only
> as an override for a different host, port, or scheme.

## Exit Codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | Bucket was already empty, or the empty operation completed and final verification passed |
| `1`  | Operator declined deletion                                                               |
| `2`  | Environment file, credential, Terraform directory, output, or mode-resolution failure    |
| `3`  | The initial non-empty check failed or returned an invalid/incomplete response            |
| `4`  | Emptying, local batch deletion, completion polling, or final verification failed         |
| `6`  | Invalid arguments, conflicting modes, unknown option, or `-q`/`-v` conflict              |
| `99` | Unexpected internal failure                                                              |

The command must not prompt or delete after an exit-`2` or exit-`3` condition. A failed or malformed
probe must never be interpreted as an empty bucket.

## API Strategy

Use one injected high-level contract for orchestration, with production and local adapters free to
use different platform-appropriate deletion mechanisms:

```ts
interface R2BucketCleaner {
  hasObjects(target: R2Target): Promise<boolean>;
  empty(target: R2Target): Promise<void>;
}
```

> **QUESTION:** Why do we need to list all objects - we only need to count the objects, so
> surely a single response with count enabled should be enough? What is the shape of the
> request/response for listing objects? Consider the situation where there are millions of
> records in the bucket - we need to be performant and listing out every record is problematic.
>
> **ANSWER:** The Cloudflare REST list response has a `result` array of object metadata and a
> `result_info` object containing `cursor`, `is_truncated`, and `per_page`; it does not contain an
> exact total count. Obtaining an exact count would require paginating through every object and
> would be unacceptable for a bucket containing millions of objects, especially because the R2
> REST API is limited to 1,200 requests per five minutes. GraphQL storage metrics are not an
> alternative because they are not guaranteed to be current or exact and require permissions
> beyond the required `Workers R2 Storage Write`. Drop the exact count. The production adapter
> makes one `GET .../objects?per_page=1` request only to distinguish an empty bucket from a
> non-empty bucket before prompting.
>
> **QUESTION:** Why are we not using the DELETE .../objects?prefix= form to delete everything?
> Is this not possible on the local miniflare? Perhaps we need an alternate API that performs
> work via miniflare instead? The remote activity is more important than local activity, so
> consider dropping local activity if this is a problem.
>
> **ANSWER:** Use `DELETE .../objects?prefix=` for production. It satisfies the bearer-token-only
> requirement, avoids transferring every key, and delegates large-bucket deletion to Cloudflare.
> Miniflare's Local Explorer does not implement that production empty operation; its collection
> delete accepts an array of object keys. Retain local support through a separate local adapter
> that paginates Local Explorer results and deletes keys in batches. Remote behavior remains the
> primary contract and is not constrained to the less efficient local mechanism.

The production adapter behavior is:

1. Probe `GET /r2/buckets/{bucket_name}/objects?per_page=1` before prompting. Return `false` from
   `hasObjects()` only after a successful, valid response containing no objects.
2. Send one `DELETE /r2/buckets/{bucket_name}/objects?prefix=` request from `empty()`.
3. Treat the DELETE response as acceptance, not completion. Poll
   `GET /r2/buckets/{bucket_name}/objects?per_page=1` with bounded backoff until the response
   contains no objects.
4. Reject failed or malformed responses. Return exit `4` if the empty request fails, polling times
   out, a poll fails, or objects remain at the completion deadline.

The local adapter behavior is:

1. Use the Local Explorer API to check for objects and paginate through all keys when deletion is
   confirmed. Accept Local Explorer's string `"true"` form of `result_info.is_truncated` while also
   validating cursors and rejecting malformed or repeated pagination state.
2. Delete keys through Local Explorer's collection delete operation in batches of at most 1,000.
3. Stop on the first failed or malformed batch, then perform a final one-object probe. Return exit
   `4` unless that probe confirms the bucket is empty.

The production base URL is
`https://api.cloudflare.com/client/v4/accounts/{account_id}` and requests use
`Authorization: Bearer {api_token}`. Local mode defaults to
`http://localhost:5173/cdn-cgi/explorer/api`, allows `--local-url` to override that base URL, and
does not send Cloudflare credentials.

The production `DELETE .../objects?prefix=` operation is used by the Cloudflare dashboard but is
not currently included in the public REST reference. Its exact response and large-bucket behavior
must be verified against a disposable bucket before implementation is considered complete.
Cloudflare documents that large empty operations can run in the background, which is why the
adapter polls the one-object list probe and does not equate a successful DELETE response with an
empty bucket.

R2 Data Catalog protections must remain effective. `--yes` bypasses only this CLI's confirmation;
it must not add headers or options that bypass Cloudflare's Data Catalog delete safeguards.

## Orchestration

The `run()` pipeline will:

1. Parse arguments and handle help/version.
2. Reject logging conflicts and invalid mode combinations with exit `6`.
3. Create the private CLI logger at the requested level.
4. Load `--env-file`, if present, without overwriting existing environment variables.
5. Resolve the remote, Terraform, or local target. Never log token values or sensitive Terraform
   output values.
6. Probe for at least one object without counting or retrieving every key.
7. Return `0` immediately when the bucket is already empty.
8. Print the bucket name and prompt `Delete all objects? (y/N) ` unless `--yes` was supplied.
9. Invoke the target adapter's empty operation: one prefix-empty request plus completion polling
   remotely, or paginated key-batch deletion locally.
10. Return `0` only after the adapter verifies that the bucket is empty.

## Implementation Files

- Add `src/cli/empty-r2-bucket/index.ts` as the shebang entry point.
- Add `src/cli/empty-r2-bucket/run.ts` for Commander parsing and orchestration.
- Add small command-specific target/output validation helpers only where they simplify direct unit
  testing; reuse `src/cli/internal/terraform.ts`, `logger.ts`, and `utils.ts`.
- Extend `src/cli/internal/cloudflare.ts` with the injected R2 objects adapter, keeping it private to
  CLI bins.
- Register the binary in `package.json`, `package-lock.json`, and `tsdown.config.ts`.
- Update `AGENTS.md`, `README.md`, `docs/specs/SPECv2.md`, `docs/guides/cli.md`,
  `skills/cloudflare-deploy-scripts/SKILL.md`, and
  `skills/cloudflare-terraform-best-practices/SKILL.md` so all CLI counts, teardown ordering, flags,
  and examples agree.

## Tests

Node tests must cover:

- Help, version, missing bucket, unknown options, every invalid mode combination, and `-q`/`-v`.
- Environment precedence, env-file failure, missing remote credentials, invalid Terraform outputs,
  and missing/failing Terraform directories.
- Remote and local URL/header construction without exposing the API token in logs.
- Empty and non-empty one-object probes, malformed responses, and probe network/HTTP failures.
- Confirmation acceptance and decline, plus `--yes` prompt bypass.
- Production prefix-empty requests, accepted asynchronous responses, bounded polling, timeouts,
  polling failures, and final verification.
- Local multi-page listings, repeated/missing cursors, exact 1,000-object batch boundaries,
  multiple batches, failed and malformed delete responses, and final verification.
- Every documented exit code and the unexpected parser-error path.
- Built-package shebang, executable mode, help, version, and `package.json#bin` mapping.

> **QUESTION:** Consider a "live" test if (and only if) you have a CLOUDFLARE_API_TOKEN - in this
> case, we can test the end-to-end capabilities against a remote service.
>
> **ANSWER:** Add an explicitly opt-in live test because the production empty endpoint is not in
> the public REST reference. Do not run destructive remote tests merely because a token happens to
> exist. The test requires `RUN_LIVE_R2_TESTS=1`, `CLOUDFLARE_ACCOUNT_ID`, and
> `CLOUDFLARE_API_TOKEN`; creates a uniquely named disposable bucket; uploads several objects
> through the REST API; invokes the empty behavior; verifies completion; and deletes the bucket in
> a `finally` block. Expose it as a separate command such as `npm run test:live:r2`; do not include
> it in normal `npm test`, coverage, or CI quality gates.

The implementation is complete only after these commands pass with no warnings or errors:

```sh
npm run check
npm run build
npm run test
npm run test:coverage
npm run docs:build
```

Per the current `CONTRIBUTING.md`, this ordinary feature PR must not add a changeset, update the
package version, or edit `CHANGELOG.md`; release metadata is handled in a dedicated release PR.
