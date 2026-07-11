# @adrianhall/cloudflare-toolkit

A toolkit of utilities and skills for developing Workers on the Cloudflare Dev Platform.
`@adrianhall/cloudflare-toolkit` replaces the boilerplate historically scattered across
multiple GitHub-only libraries — defensive guards, HTTP error generators, RFC 9457 problem
details, structured logging, and Cloudflare Access-aware Hono/Vite middleware — with a single,
MIT-licensed, npm-installable package.

**Full documentation, guides, and API reference:**
https://adrianhall.github.io/cloudflare-toolkit

## Install

```sh
npm install @adrianhall/cloudflare-toolkit
```

## Quickstart

The `hono` subpath exports four independent middleware for a Cloudflare Access-protected Hono
app: structured logging, Access enforcement, and problem-details-based error handling. Each is
wired independently:

```ts
import {
  cloudflareAccess,
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler
} from "@adrianhall/cloudflare-toolkit/hono";
import { Hono } from "hono";

const app = new Hono();

app.use(cloudflareLogger({/* ... */}));
app.use(cloudflareAccess({/* ... */}));

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

export default app;
```

See the [documentation site](https://adrianhall.github.io/cloudflare-toolkit) for guides
covering every export, including the defensive guards, HTTP error generators, the standalone
logging core, the Vite plugin, and the `generate-wrangler-types` CLI.

## AI Skill

An installable [Agent Skill](https://www.npmjs.com/package/skills) teaches coding agents how to
use every export in this package:

```sh
npx skills add adrianhall/cloudflare-toolkit
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the PR/changeset/release process, and
[`AGENTS.md`](./AGENTS.md) for engineering conventions.

## License

[MIT](./LICENSE)
