#!/usr/bin/env node
/** @file Executable entry point for `destroy-containers`. */
import { createContainersApi, createRegistryClient } from "../internal/cloudflare.js";
import { createLogger } from "../internal/logger.js";
import { createEnvLoader, createPrompter } from "../internal/utils.js";
import { run } from "./run.js";

const logger = createLogger({ level: "info" });
process.exit(
  await run(process.argv, {
    containers: createContainersApi(logger),
    registry: createRegistryClient(logger),
    prompter: createPrompter(),
    envLoader: createEnvLoader()
  })
);
