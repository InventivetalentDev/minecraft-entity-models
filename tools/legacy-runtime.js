import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { download } from './download.js';
import { legacyAnimationRequests } from './legacy-animations.js';

const run = promisify(execFile);
const FABRIC = 'https://maven.fabricmc.net/net/fabricmc';
const TOOLS = [
  ['remapper.jar', `${FABRIC}/tiny-remapper/0.11.2/tiny-remapper-0.11.2-fat.jar`, '602cbb9b8e875e10f2600163b2f8bb7db022cdef'],
  ['intermediary.jar', `${FABRIC}/intermediary/1.16.5/intermediary-1.16.5-v2.jar`, '5da71b4e6431dbfc64f62acb11b40e381a365934'],
  ['yarn.jar', `${FABRIC}/yarn/1.16.5+build.6/yarn-1.16.5+build.6-v2.jar`, '233298a5b3e107a6c4ede597b666dc872bff00dc'],
];

function allowed(library) {
  let result = !library.rules;
  const platform = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'x86' }[process.arch] ?? process.arch;
  for (const rule of library.rules ?? []) {
    if (rule.os?.name && rule.os.name !== platform) continue;
    if (rule.os?.arch && !new RegExp(`^(?:${rule.os.arch})$`).test(arch)) continue;
    if (rule.features && Object.values(rule.features).some(Boolean)) continue;
    result = rule.action === 'allow';
  }
  return result;
}

export async function extractLegacyData(options) {
  const runtime = await prepareLegacyRuntime(options);
  try {
    const input = path.join(runtime.directory, 'inputs.json');
    const output = path.join(runtime.directory, 'models.json');
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
    const args = ['-Djava.awt.headless=true', '--class-path', runtime.classpath,
      fileURLToPath(new URL('./LegacyModels.java', import.meta.url)), input, output];
    await writeFile(input, JSON.stringify({ requests: [] }));
    await run(java, args, { cwd: runtime.directory, maxBuffer: 16 * 1024 * 1024 });
    const data = JSON.parse(await readFile(output, 'utf8'));
    await writeFile(input, JSON.stringify({ requests: legacyAnimationRequests(data.inventory) }));
    try {
      await run(java, args, { cwd: runtime.directory, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      throw new Error(`Legacy animation sampling failed: ${error.stdout || error.stderr || error.message}`);
    }
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await runtime.dispose();
  }
}

// Yarn's field names preserve the bone names in the original 1.16.5 dictionaries.
export async function prepareLegacyRuntime({ cache, offline = false, legacyCache = path.join(cache, 'yarn-1.16.5') }) {
  const hash = 'fba9f7833e858a1257d810d21a3a9e3c967f9077';
  const metadata = JSON.parse(await download(`https://piston-meta.mojang.com/v1/packages/${hash}/1.16.5.json`,
    path.join(legacyCache, 'version.json'), hash, offline));
  const client = path.join(legacyCache, 'client.jar');
  await download(metadata.downloads.client.url, client, metadata.downloads.client.sha1, offline);
  const libraries = [];
  for (const library of metadata.libraries.filter(allowed)) {
    const artifact = library.downloads?.artifact;
    if (!artifact) continue;
    const file = path.join(legacyCache, 'libraries', artifact.path);
    await download(artifact.url, file, artifact.sha1, offline);
    libraries.push(file);
  }
  for (const [name, url, checksum] of TOOLS) await download(url, path.join(legacyCache, name), checksum, offline);
  const directory = await mkdtemp(path.join(tmpdir(), 'minecraft-legacy-runtime-'));
  const tool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
  try {
    let input = client;
    for (const [name, from, to] of [['intermediary', 'official', 'intermediary'], ['yarn', 'intermediary', 'named']]) {
      const output = path.join(directory, `${to}.jar`);
      await run(tool('jar'), ['xf', path.join(legacyCache, `${name}.jar`), 'mappings/mappings.tiny'], { cwd: directory });
      await run(tool('java'), ['-jar', path.join(legacyCache, 'remapper.jar'), input, output,
        path.join(directory, 'mappings/mappings.tiny'), from, to, ...libraries, '--fixPackageAccess'],
      { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
      input = output;
    }
    return { classpath: [input, ...libraries].join(path.delimiter), directory,
      dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
