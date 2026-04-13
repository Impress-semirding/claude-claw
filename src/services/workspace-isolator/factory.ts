import type { WorkspaceIsolator } from './index.js';
import { CrunIsolator } from './crun.js';
import { PassthroughIsolator } from './passthrough.js';

let instance: WorkspaceIsolator | undefined;

export function getIsolator(): WorkspaceIsolator {
  if (instance) {
    return instance;
  }

  const platform = process.platform;

  if (platform === 'linux') {
    instance = new CrunIsolator();
  } else {
    // macOS sandbox-exec is deprecated/unstable; fall back to passthrough
    instance = new PassthroughIsolator();
  }

  return instance;
}

export function setIsolator(isolator: WorkspaceIsolator): void {
  instance = isolator;
}
