#!/usr/bin/env node
/** @file Executable entry point for `empty-r2-bucket`. */
import { createR2Client } from "../internal/cloudflare.js";
import { createLogger } from "../internal/logger.js";
import { createTerraformRunner } from "../internal/terraform.js";
import { createEnvLoader, createPrompter } from "../internal/utils.js";
import { createFileSystem } from "./fs.js";
import { run } from "./run.js";

process.exit(
  await run(process.argv, {
    terraform: createTerraformRunner(),
    r2: createR2Client(createLogger({ level: "info" })),
    prompter: createPrompter(),
    envLoader: createEnvLoader(),
    fs: createFileSystem()
  })
);
