/** @file Command-specific filesystem contract for `generate-wrangler`. */
export interface FileSystem {
  /** Reads a UTF-8 file. */
  readFile(path: string): Promise<string>;
  /** Writes a UTF-8 file. */
  writeFile(path: string, content: string): Promise<void>;
  /** Tests whether a path exists. */
  fileExists(path: string): Promise<boolean>;
  /** Tests whether a path exists and is a directory. */
  directoryExists(path: string): Promise<boolean>;
}
