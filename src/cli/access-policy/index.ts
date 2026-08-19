#!/usr/bin/env node
/** @file Executable entry point for `cf-access-policy`. */
import { createEnvLoader, createPrompter } from "../internal/utils.js";
import { createAccessApi } from "./cf.js";
import { run } from "./run.js";

process.exit(
  await run(process.argv, {
    createApi: (profile) => createAccessApi(profile),
    prompter: createPrompter(),
    envLoader: createEnvLoader()
  })
);
