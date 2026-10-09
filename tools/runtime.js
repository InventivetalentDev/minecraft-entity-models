import os from 'node:os';
import path from 'node:path';
import { download } from './download.js';

export const javaTool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;

export function allowedLibrary(library) {
  let allowed = !library.rules;
  const osName = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'x86' }[process.arch] || process.arch;
  for (const rule of library.rules || []) {
    if (rule.os?.name && rule.os.name !== osName) continue;
    if (rule.os?.arch && !new RegExp(`^(?:${rule.os.arch})$`).test(arch)) continue;
    if (rule.os?.version && !new RegExp(rule.os.version).test(os.release())) continue;
    if (rule.features && Object.values(rule.features).some(Boolean)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

export async function downloadLibraries(libraries, fileFor, offline = false) {
  const artifacts = [...new Map(libraries.filter(allowedLibrary)
    .map(library => library.downloads?.artifact).filter(Boolean).map(artifact => [artifact.sha1, artifact])).values()];
  const files = [];
  for (let index = 0; index < artifacts.length; index += 6) {
    const results = await Promise.allSettled(artifacts.slice(index, index + 6).map(async artifact => {
      const file = fileFor(artifact);
      await download(artifact.url, file, artifact.sha1, offline);
      return file;
    }));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      files.push(result.value);
    }
  }
  return files;
}
