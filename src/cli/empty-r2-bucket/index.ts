#!/usr/bin/env node
/** @file Executable entry point for `empty-r2-bucket`. */
import { createLocalR2Cleaner, createRemoteR2Cleaner } from "../internal/cloudflare.js";
import { createLogger } from "../internal/logger.js";
import { createTerraformRunner } from "../internal/terraform.js";
import { createEnvLoader, createPrompter } from "../internal/utils.js";
import { run } from "./run.js";

const logger = createLogger({ level: "info" });
process.exit(
  await run(process.argv, {
    remoteCleaner: createRemoteR2Cleaner(logger),
    localCleaner: createLocalR2Cleaner(logger),
    terraform: createTerraformRunner(),
    prompter: createPrompter(),
    envLoader: createEnvLoader()
  })
);
