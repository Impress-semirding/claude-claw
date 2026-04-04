import type { WorkspaceIsolator } from './index.js';
import { SandboxExecIsolator } from './sandbox-exec.js';
import { CrunIsolator } from './crun.js';
import { PassthroughIsolator } from './passthrough.js';

let instance: WorkspaceIsolator | undefined;

export function getIsolator(): WorkspaceIsolator {
  if (instance) {
    return instance;
  }

  const platform = process.platform;

  if (platform === 'darwin') {
    instance = new SandboxExecIsolator();
  } else if (platform === 'linux') {
    instance = new CrunIsolator();
  } else {
    instance = new PassthroughIsolator();
  }

  return instance;
}

export function setIsolator(isolator: WorkspaceIsolator): void {
  instance = isolator;
}
