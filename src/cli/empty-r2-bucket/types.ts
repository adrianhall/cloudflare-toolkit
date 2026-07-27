/** @file Filesystem contract for `empty-r2-bucket`. */
export interface FileSystem {
  /** Tests whether a path exists and is a directory. */
  directoryExists(path: string): Promise<boolean>;
}
