# Cloudflare Toolkit - a set of libraries and skills for developing Cloudflare apps

When developing Cloudflare apps, we use the following commonly:

- Cloudflare Workers
- Cloudflare Workers Observability
- Cloudflare D1
- Cloudflare Durable Objects
- Cloudflare Workers Static Assets

For software, our stack is commonly:

- wrangler for CI/CD and deployment
- vite for build orchestration
- vitest for testing
- hono for HTTP API handling
- svelte or sveltekit for web UIs

To assist with this, several small libraries have been produced:

- [`adrianhall/cloudflare-auth`](../../cloudflare-auth) provides capabilities for Hono and Vite to simulate Cloudflare Access.
- [`adrianhall/cloudflare-logger`](../../cloudflare-logger) provides structured logging capabilities as Hono middleware.
- [`adrianhall/cloudflare-scripts`](../../cloudflare-scripts) provides a few scripts and skills for working with Terraform and wrangler - most notably, generate-types is a mechanism for building `worker-configuration.d.ts` only when needed.

These small libraries are installed from github directly and are not distributed to npm package repositories. Some of tthese libraries have "prepare" steps that require approvescript to be run as part of installation.

We've also updated [`hono-problem-details`](../../hono-problem-details) to support sourcemaps as that feature was missing from the original code.

There is standard hono/cloudflare-access middleware that can be installed for handling cloudflare access - this duplicates functionality within adrianhall/cloudflare-access (specifically, the hono middleware). Also, with the vite plugin, the "developerAuth" middleware is no longer relevant. Work needs to be done to integrate these pieces properly.

In addition, there is missing functionality that we still want to add in:

- A solid mechanism for error reporting, which includes throwable error generators and an error handler that can be wired into a hono app with `app.onError()` for working with `hono-problem-details` and returning properly formed RFC 9457 problem details.
- A standard "not found" handler that uses the same functionality to return a problem-details 404 error.

Additional functionality is proposed to fill other gaps that are common in D1-driven and Durable Object apps.

## Proposal

Build a new "cloudflare-toolkit" library that supercedes all three github libraries. This new library will be distributed via CI/CD to npm as `@adrianhall/cloudflare-toolkit` using the latest publishing techniques. It will include:

- The functionality from `cloudflare-auth` for the `cloudflareAccess` middleware and vite `cloudflareAccessPlugin()` but removing the developerAuthentication middleware (as the vite plugin now supports this functionality).
- The `generate-types` script from `cloudflare-scripts`, renamed as `generate-wrangler-types`.
- The `hono-problem-details` upgrade (probably renamed so it's integrated properly)
- The `cloudflare-logger` code
- The proposed HTTP error generators for throwing problem detail augmented errors.
- The proposed onError handler.
- A set of skills, installable with `npx skills add`, for the toolkit functionality.

At the end of this project, the developer can integrate cloudflare functionality by:

1. `npm install @adrianhall/cloudflare-toolkit`
2. `npx skills add adrianhall/cloudflare-toolkit`
3. Add a prebuild step to package.json for "generate-wrangler-types" to generate the worker-configuration.d.ts
4. Update vite.config.ts with the following code:

```ts
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit";

vite.defineConfig([cloudflareAccessPlugin(), cloudflare(), svelte()]);
```

5. Incorporate the middleware with:

```ts
import { cloudflareToolkitMiddleware } from '@adrianhall/cloudflare-toolkit';
import type { CloudflareToolkitOptions } from '@adrianhall/cloudflare-toolkit';

const app = new Hono<AppContext>();

// These are all default options
const options: CloudflareToolkitOptions = {
  logger: {
    enabled: true
    env: 'ENVIRONMENT'
  },
  errorHandler: {
    enabled: true
  },
  authentication: {
    enabled: true
  }
};

app.use(cloudflareToolkitMiddleware(options));
```

Alternative, the developer can split things out:

```ts
app.use(cloudflareLogger({ env: 'ENVIRONMENT' });
app.use(cloudflareAccess());
app.onError(problemDetailsErrorHandler());
```

In addition, the user can throw errors that are returned by the `onError` handler as problem-details:

```ts
import { forbidden } from "@adrianhall/cloudflare-toolkit";

throw forbidden({ details: "some detail" });
```

Finally, we want a set of defensive guards that help us reach 100% coverage by avoiding untestable defensive programming paths. The common defensive guards that we use are:

- `throwIfNull(value: unknown, message: string)` asserts value is not null, throws `NullError` if the value is null or undefined. `NullError` is an extension of the error that is thrown by internalServerError() so that, if not caught, a proper problem details with stack trace is produced. Avoids `if (!value) throw Error...` which are defensive.
- `valueOrDefault<T>(value: T | null | undefined, defaultValue: T): T` avoids `??` coalescing operations when the RHS is generally not reachable.
- `sqlCount(value: unknown, countProperty: string = 'count'): Number` avoids the null-coalescing defensive guards after you have executed `SELECT COUNT() AS count FROM table...` operations and never expect the row to be undefined.

Finally, all these are also available on sub-paths:

- `hono` contains middleware (including the onError middleware)
- `vite` contains vite plugins
- `logging` contains the logging capability
- `errors` contains the error generators
- `guards` for a set of common defensive guards
- `problem-details` contains the code from the `hono-problem-details` project

This allows more specific targeting of the code if needed.

## Skills

We provide a `cloudflare-toolkit` skills in `skills/cloudflare-toolkit/SKILL.md` to assist with cloudflare dev platform coding when using Hono or Vite. It is installable using `npx skills add`. It should reference the common patterns that we are establishing within this library. It can reference other skills that should be consulted if available; for example, `cloudflare`, `wrangler`, `workers-best-practices`, and `durable-objects`.

Additional hints should be provided (based on the samples in cloudflare docs) on how to do migrations for vitest and wrangler. It's a common problem that most Hono based wrangler apps will face and get wrong. vite and vitest both have specific pages in the Cloudflare Docs (available via MCP) that can be referenced, and there are lots of samples demonstrating good patterns linked from the docs (TODO: provide page link)

In addition, we also provide an `AGENTS.md` within this repository to guide implementation for the toolkit. The one major rule is to always consult the latest documentation for cloudflare (via MCP), Hono, Vite, and vitest. note that vite and vitest both have specific documentation pages that MUST be consulted when working with vite or vitest in a cloudflare dev platform context

## Repository Rules

1. `npm run check` should run `tsc` for type checking, `eslint` for static analysis.
2. All public code must have JSDoc comments in full. Enforced via eslint
3. eslint configured for recommendedTypeChecked, stylisticTypeChecked, and disallowing deprecated (from strict set)
4. Use TypeScript 7.0 (newly released)
5. Use husky to automatically run prettier on check-in.
6. husky should also disallow check-ins that don't pass tsc, eslint gates.
7. vitest is used for testing - 100% target, with istanbul for coverage
   - Focus on functional testing
   - testable defensive guards should be used for unreachable code
   - If a branch is trivially testable, test it
   - If something is truly untestable (for environment), get approval, then comment with an istanbul ignore next command. Ensure you provide the reason that it is untestable.

## Future extensions / feature requests

### Data Access Patterns

One of the big gaps is data processing. It's common for us to have HATEOS/REST APIs for CRUDL, constructed to support D1 (or SQLite within a DO) and these can be significantly simplified by providing core repositories and API handlers for conditional requests and HATEOS links.

In an ideal situation, this pattern would have an opinion on the shape of a resource and a repository, and the API would be easy to read with support for RBAC, content validation, conditional requests, and HATEOS links. Use valibot for validation and prefer middleware / thrown errors so that the "happy path" to the 200/201/204 is simple. I should be able to write something like:

```ts
const router = new ResourceRouter<AppContext>((ctx) => {
  repository: new ResourceRepository(ctx.get('zoneId')),
  validator: new ResourceValidator(),
  accessControl: new ResourceAccessControl(ctx)
});
app.route('/api/resource', resourceApi);
```

I look to something like [CommunityToolkit/Datasync](https://github.com/CommunityToolkit/Datasync) in the .NET world for inspiration as it provides per-user access controls, in-flight entity adjustment (e.g. to add owner information), and simplifies the code to be written.

### Websocket Patterns

Another is support for "WebSocket" durable objects. Instead of extending "DurableObject", we can extend "WebSocketDurableObject" to provide the core functionality of handling durable object communications. In addition, we can provide a standard API handler for Hono to forward the request to a web socket handler. This will simplify the code that the user writes to support this functionality.
