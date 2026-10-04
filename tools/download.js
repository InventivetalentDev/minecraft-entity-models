import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const DEFAULT_CACHE = '.cache/minecraft-entity-models';

export function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

export async function exists(file) {
  try { await access(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function download(url, file, expectedHash, offline = false, refresh = false) {
  if (!refresh && await exists(file)) {
    const bytes = await readFile(file);
    if (expectedHash && sha1(bytes) !== expectedHash) throw new Error(`SHA-1 mismatch: ${file}`);
    return bytes;
  }
  if (offline) throw new Error(`Offline cache miss: ${file}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedHash && sha1(bytes) !== expectedHash) throw new Error(`SHA-1 mismatch: ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
  return bytes;
}

export async function loadVersion(version, cache, offline = false) {
  const manifest = JSON.parse(await download(MANIFEST, path.join(cache, 'manifest.json'), null, offline, !offline));
  const entry = manifest.versions.find(entry => entry.id === version);
  if (!entry) throw new Error(`Version not found in Mojang manifest: ${version}`);
  if (!/^[a-zA-Z0-9._-]+$/.test(entry.id)) throw new Error(`Invalid version id: ${entry.id}`);
  const directory = path.join(cache, entry.id);
  const metadata = JSON.parse(await download(entry.url, path.join(directory, `${entry.sha1}.json`), entry.sha1, offline));
  return { entry, metadata, directory };
}

export async function downloadClient(metadata, directory, offline = false) {
  const client = metadata.downloads.client;
  const file = path.join(directory, `client-${client.sha1}.jar`);
  await download(client.url, file, client.sha1, offline);
  return file;
}
