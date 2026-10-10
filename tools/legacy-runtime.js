import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { download, downloadClient, exists, loadVersion, sha1 } from './download.js';
import { legacyAnimationRequests } from './legacy-animations.js';
import { downloadLibraries, javaTool } from './runtime.js';

const run = promisify(execFile);
const FABRIC = 'https://maven.fabricmc.net/net/fabricmc';
const TOOLS = [
  ['remapper.jar', `${FABRIC}/tiny-remapper/0.11.2/tiny-remapper-0.11.2-fat.jar`, '602cbb9b8e875e10f2600163b2f8bb7db022cdef'],
  ['intermediary.jar', `${FABRIC}/intermediary/1.16.5/intermediary-1.16.5-v2.jar`, '5da71b4e6431dbfc64f62acb11b40e381a365934'],
  ['yarn.jar', `${FABRIC}/yarn/1.16.5+build.6/yarn-1.16.5+build.6-v2.jar`, '233298a5b3e107a6c4ede597b666dc872bff00dc'],
];

export async function extractLegacyData(options) {
  const runtime = await prepareLegacyRuntime(options);
  try {
    const output = path.join(runtime.directory, 'models.json');
    const args = ['-Djava.awt.headless=true', '--class-path', runtime.classpath,
      fileURLToPath(new URL('./LegacyModels.java', import.meta.url)), '-', output];
    await new Promise((resolve, reject) => {
      let failure;
      let sent = false;
      const child = execFile(javaTool('java'), args, { cwd: runtime.directory, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (failure) reject(failure);
        else if (error) {
          const logs = stdout.split(/\r?\n/).filter(line => !line.startsWith('MODEL_INVENTORY\t')).join('\n');
          const details = [['stderr', stderr.trim()], ['stdout', logs.trim()]]
            .filter(([, text]) => text).map(([stream, text]) => `${stream}:\n${text}`).join('\n');
          reject(new Error(`Legacy extraction failed: ${details || error.message}`));
        } else if (!sent) reject(new Error('Legacy runtime did not provide its model inventory'));
        else resolve();
      });
      const fail = error => { failure ??= error; child.kill(); };
      child.stdin.on('error', fail);
      createInterface({ input: child.stdout }).on('line', line => {
        if (!line.startsWith('MODEL_INVENTORY\t')) return;
        try {
          if (sent) throw new Error('Legacy runtime provided its model inventory twice');
          const inventory = JSON.parse(line.slice('MODEL_INVENTORY\t'.length));
          const requests = legacyAnimationRequests(inventory);
          sent = true;
          child.stdin.end(JSON.stringify({ requests }) + '\n');
        } catch (error) { fail(error); }
      });
    });
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await runtime.dispose();
  }
}

// Yarn's field names preserve the bone names in the original 1.16.5 dictionaries.
export async function prepareLegacyRuntime({ cache, offline = false, legacyCache = path.join(cache, 'yarn-1.16.5'),
  metadata, clientJar }) {
  cache = path.resolve(cache);
  legacyCache = path.resolve(legacyCache);
  if (clientJar) clientJar = path.resolve(clientJar);
  const versionDirectory = path.join(cache, '1.16.5');
  metadata ??= (await loadVersion('1.16.5', cache, offline)).metadata;
  clientJar ??= await downloadClient(metadata, versionDirectory, offline);
  const libraries = await downloadLibraries(metadata.libraries,
    artifact => path.join(cache, 'libraries', `${artifact.sha1}.jar`), offline);
  for (const [name, url, checksum] of TOOLS) await download(url, path.join(legacyCache, name), checksum, offline);
  const remapKey = sha1(JSON.stringify({ client: metadata.downloads.client.sha1,
    tools: TOOLS.map(([, , checksum]) => checksum), libraries: libraries.map(file => path.basename(file)), fixPackageAccess: true }));
  const named = path.join(versionDirectory, `yarn-mapped-${remapKey}.jar`);
  const checksum = `${named}.sha1`;
  const cached = await exists(named) && await exists(checksum);
  if (cached && sha1(await readFile(named)) !== (await readFile(checksum, 'utf8')).trim()) {
    throw new Error(`SHA-1 mismatch: ${named}`);
  }
  await mkdir(versionDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(versionDirectory, 'runtime-'));
  try {
    if (!cached) {
      let input = clientJar;
      for (const [name, from, to] of [['intermediary', 'official', 'intermediary'], ['yarn', 'intermediary', 'named']]) {
        const output = path.join(directory, `${to}.jar`);
        await run(javaTool('jar'), ['xf', path.join(legacyCache, `${name}.jar`), 'mappings/mappings.tiny'], { cwd: directory });
        await run(javaTool('java'), ['-jar', path.join(legacyCache, 'remapper.jar'), input, output,
          path.join(directory, 'mappings/mappings.tiny'), from, to, ...libraries, '--fixPackageAccess'],
        { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
        input = output;
      }
      await rename(input, named);
      await writeFile(checksum, sha1(await readFile(named)) + '\n');
    }
    return { classpath: [named, ...libraries].join(path.delimiter), directory,
      dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
