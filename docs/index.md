---
layout: home

hero:
  name: cloudflare-toolkit
  text: Utilities for the Cloudflare Dev Platform
  tagline: Defensive guards, RFC 9457 problem details, structured logging, and Cloudflare Access-aware Hono/Vite middleware — one MIT-licensed, npm-installable package.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /reference/
    - theme: alt
      text: View on GitHub
      link: https://github.com/adrianhall/cloudflare-toolkit

features:
  - title: Defensive Guards
    details: throwIfNull, valueOrDefault, and sqlCount — small, individually-tested helpers that keep ad hoc defensive branches out of application code.
  - title: RFC 9457 Problem Details
    details: HTTP error generators (badRequest, notFound, internalServerError, ...) that pair with a Hono onError handler to produce standards-based application/problem+json responses.
  - title: Structured Logging
    details: A framework-agnostic logging core plus a Hono middleware that attaches a request-scoped Logger to the context.
  - title: Cloudflare Access-Aware Middleware
    details: cloudflareAccess (Hono) validates Access JWTs in production; cloudflareAccessPlugin (Vite) emulates the same edge behavior during local development — fail-closed by default.
  - title: generate-wrangler-types CLI
    details: Keeps your Worker's Env binding types in sync with wrangler.jsonc.
  - title: Ships an AI Skill
    details: "npx skills add adrianhall/cloudflare-toolkit teaches coding agents every export in this package."
---
