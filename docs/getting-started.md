# Getting Started

The Cloudflare Toolkit is a set of utilities that speed up development of multi-tier apps written for [Cloudflare Workers], using a combination of [Vite] plugins, [Hono] utilities, and [CLI tools]. It is a complement to the official [Cloudflare tooling], including [Wrangler] and the [vite plugin].

All apps start life as a [vite-based hono app]:

```bash
npm create cloudflare@latest -- tutorial --template=cloudflare/templates/vite-react-template
```

## Install the toolkit and set up environments

```bash
npm install @adrianhall/cloudflare-toolkit hono
```

Once installed, set up your environments. There are three known environment names (`production`, `development`, and `test`). Edit your `wrangler.jsonc` and add an environment variable:

```json
"vars": {
  "ENVIRONMENT": "production"
}
```

Create a `.dev.vars` file to override when developing locally:

```json
ENVIRONMENT=development
```

Finally, edit the `worker/index.ts` to include a real Web API:

```ts
import { Hono } from "hono";

interface AppVariables {
  // Custom variables go here
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get("/api/me", (c) => {
  return c.json({ email: "not-known" });
});

export default app;
```

This code is your basic "worker" pattern for an API. You can request `/api/me` in your browser or a tool like [Insomnia] or [Postman] and see the JSON block. We'll augment this code during this short tutorial.

## Add RFC 9457 error handling

When something goes wrong, you want to report that back to the user. [RFC 9457] is the standard mechanism for reporting errors to clients with problem details. You can quickly add [error handling](/guides/error-handling.md) to your app:

```ts{2-3,11-12,19}
import { Hono } from "hono";
import { badRequest } from "@adrianhall/cloudflare-toolkit";
import { problemDetailsErrorHandler, notFoundHandler } from "@adrianhall/cloudflare-toolkit/hono";

interface AppVariables  {
  // Custom variables go here
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/api/me", (c) => {
  return c.json({ email: "not-known" });
});

app.get("/api/error", (c) => {
  throw badRequest({ detail: "This is a custom error" });
});

export default app;
```

Now use your browser to go to a missing API and you will see an RFC 9457 compliant 404 response. Go to `/api/error` and you will free an RFC 9457 compliant 400 response with some details. We have generators for all the common HTTP error codes and allow you to generate your own for codes not already covered.

## Add structured logging

Cloudflare Workers includes a mechanism for [recording structured logging]. Cloudflare Toolkit provides [an injectable logger](/guides/logging.md) that configures itself based on your environment - structured logging in production that Cloudflare Observability can understand, and pretty console logs in development.

Let's augment the example with logging:

```ts{4,16,21,26}
import { Hono } from "hono";
import { badRequest } from "@adrianhall/cloudflare-toolkit";
import {
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler,
  type CloudflareToolkitVariables
} from "@adrianhall/cloudflare-toolkit/hono";

interface AppVariables extends CloudflareToolkitVariables {
  // Custom variables go here
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(cloudflareLogger());
app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/api/me", (c) => {
  c.var.LOGGER.info("Received /api/me request");
  return c.json({ email: "not-known" });
});

app.get("/api/error", (c) => {
  c.var.LOGGER.warn("Received /api/error request", { url: c.req.url });
  throw badRequest({ detail: "This is a custom error" });
});

export default app;
```

The `CloudflareToolkitVariables` contains the variable definitions for the Cloudflare Toolkit. The `cloudflareLogger()` method injects a logger into the Hono context so it is available everywhere.

## Add Cloudflare Access

Enterprise apps need authentication. [Cloudflare Access] is a great way to provide a common authentication layer for all your apps. However, it's not included in [Miniflare], so you have to emulate it. Our [middleware and vite plugin](/guides/authentication.md) allow you to use Cloudflare Access in production, but simulate it in local development.

In production, `cloudflareAccess` verifies each request's JWT against your team's public keys, so it need your Cloudflare Access team domain. Add it to the `vars` block in `wrangler.jsonc` alongside `ENVIRONMENT` (the vite plugin emulates Access locally, so this isn't needed while developing):

```json
"vars": {
  "ENVIRONMENT": "production",
  "CLOUDFLARE_TEAM_DOMAIN": "my-team.cloudflareaccess.com"
}
```

The middleware reads `CLOUDFLARE_TEAM_DOMAIN` from the environment automatically. Then wire it up in three
steps:

### 1. Set up your path policy

The path policy is an array of `PathPolicy` objects that define how you want the application to act. This is best done in a separate file because both the vite plugin and your code need it:

```ts
/** @file auth-policies.ts */
import { type PathPolicy } from "@adrianhall/cloudflare-toolkit/hono";

export const authPolicies: PathPolicy[] = [{ pattern: /^\/api\/version$/, authenticate: false }];
```

### 2. Set up vite

Edit your `vite.config.ts`:

```ts{4-5,9}
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";
import { authPolicies } from "./worker/auth-policies";

export default defineConfig({
  plugins: [
    cloudflareAccessPlugin({ policies: authPolicies }),
    cloudflare(),
    react()
  ],
})
```

### 3. Inject the cloudflareAccess middleware

Finally, in your app, you need to add the `cloudflareAccess` middleware:

```ts{4,10,19,25}
import { Hono } from "hono";
import { badRequest } from "@adrianhall/cloudflare-toolkit";
import {
  cloudflareAccess,
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler,
  type CloudflareToolkitVariables
} from "@adrianhall/cloudflare-toolkit/hono";
import { authPolicies } from "./auth-policies";

interface AppVariables extends CloudflareToolkitVariables {
  // Custom variables go here
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(cloudflareLogger());
app.use(cloudflareAccess({ policies: authPolicies, enableDevTokens: import.meta.env.DEV }));
app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/api/me", (c) => {
  c.var.LOGGER.info("Received /api/me request", { user: c.var.userSub });
  return c.json({ email: c.var.userEmail });
});

app.get("/api/error", (c) => {
  c.var.LOGGER.warn("Received /api/error request", { url: c.req.url });
  throw badRequest({ detail: "This is a custom error" });
});

export default app;
```

The `CloudflareToolkitVariables` contains the variable names `userEmail` and `userSub` that can be used in your application to support authorization requests.

## Automate type generation

Whenever you add or change a binding within `wrangler.jsonc`, you must re-generate the `worker-configuration.d.ts` file by using `wrangler types`. This is a common friction point since you don't want the file updated all the time. We wrote [a small CLI tool](/guides/cli.md) that only runs `wrangler types` when the `wrangler.jsonc` file actually changes. This allows you to wire the script into a "prebuild" or "prestart" script in `package.json`:

```json{2,4,6,10}
  "scripts": {
    "predev": "generate-wrangler-types",
    "dev": "vite",
    "prebuild": "generate-wrangler-types",
    "build": "tsc -b && vite build",
    "prelint": "generate-wrangler-types",
    "lint": "eslint .",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "generate-wrangler-types"
  },
```

## Next steps

Review our in-depth guides on each function area:

- [Error handling](./guides/error-handling.md)
- [Logging](./guides/logging.md)
- [Authentication & Authorization](./guides/authentication.md)
- [Command line tools](./guides/cli.md)
- [Testing](./guides/testing.md)
- [Vite and Vitest](./guides/vite-vitest.md)

<!-- Links -->

[Cloudflare Access]: https://developers.cloudflare.com/cloudflare-one/access-controls/
[Cloudflare Workers]: https://developers.cloudflare.com/workers/
[Cloudflare tooling]: https://developers.cloudflare.com/workers/local-development/
[CLI tools]: ./guides/cli.md
[Hono]: https://hono.dev/docs/
[Miniflare]: https://developers.cloudflare.com/workers/testing/miniflare/
[Vite]: https://vite.dev/guide/
[vite plugin]: https://developers.cloudflare.com/workers/vite-plugin/
[vite-based hono app]: https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
[Wrangler]: https://developers.cloudflare.com/workers/wrangler/
[recording structured logging]: https://developers.cloudflare.com/workers/observability/logs/
[Insomnia]: https://insomnia.rest/
[Postman]: https://www.postman.com/
[RFC 9457]: https://www.rfc-editor.org/info/rfc9457/
