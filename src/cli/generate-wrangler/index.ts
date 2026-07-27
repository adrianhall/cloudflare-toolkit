#!/usr/bin/env node
/** @file Executable entry point for `generate-wrangler`. */
import { createTerraformRunner } from "../internal/terraform.js";
import { createFileSystem } from "./fs.js";
import { run } from "./run.js";

process.exit(
  await run(process.argv, { terraform: createTerraformRunner(), fs: createFileSystem() })
);
