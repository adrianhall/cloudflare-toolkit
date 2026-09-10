#!/usr/bin/env node
/** @file Executable entry point for `cf-inventory`. */
import { createEnvLoader } from "../internal/utils.js";
import { run } from "./run.js";

process.exitCode = await run(process.argv, { fetchImpl: fetch, envLoader: createEnvLoader() });
