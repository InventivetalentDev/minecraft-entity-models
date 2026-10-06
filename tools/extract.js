import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stableStringify, writeDataset } from './lib.js';
import { blockTextureRecords, expandBlocks, listBlockIds, loadBlockFamilies } from './blocks.js';
import { addTextures, validateTextures } from './textures.js';
import { applyTransforms } from './transform.js';
import { applyPasses } from './passes.js';
import { buildAnimations } from './animations.js';
import { DEFAULT_CACHE, download, downloadClient, exists, loadVersion, sha1 } from './download.js';

const ART_VERSION = '2.0.18';
const ART_SHA1 = '59bd788e0a1bd339256711dee40015a62cdf3cd2';
const ART_URL = `https://maven.neoforged.net/releases/net/neoforged/AutoRenamingTool/${ART_VERSION}/AutoRenamingTool-${ART_VERSION}-all.jar`;
const JAVA = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.on('error', error => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(
      `${path.basename(command)} exited with code ${code}: ${output.trim()}`)));
  });
}

function allowedLibrary(library) {
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

async function main() {
  const values = { offline: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const name = args[index].slice(2);
    if (args[index] === '--offline' && !values.offline) {
      values.offline = true;
    } else if (['--version', '--output', '--cache'].includes(args[index]) && !values[name] && args[index + 1] && !args[index + 1].startsWith('--')) {
      values[name] = args[++index];
    } else {
      throw new Error(`Unknown or incomplete option: ${args[index]}`);
    }
  }
  if (!values.version || !values.output) throw new Error('Usage: node tools/extract.js --version VERSION --output DIR [--cache DIR] [--offline]');
  const output = path.resolve(values.output);
  if (await exists(output)) throw new Error(`Output directory already exists: ${output}`);
  const cache = path.resolve(values.cache || DEFAULT_CACHE);
  const { entry, metadata, directory } = await loadVersion(values.version, cache, values.offline);
  if ((/^1\.(\d+)/.test(entry.id) && Number(entry.id.match(/^1\.(\d+)/)[1]) < 17) || !metadata.downloads.client_mappings) {
    throw new Error('Use the legacy converter for Minecraft versions before 1.17');
  }
  const requiredJava = Math.max(17, metadata.javaVersion?.majorVersion || 17);
  const javaVersion = await run(JAVA, ['-version']);
  const javaMajor = Number(javaVersion.match(/version "(\d+)/)?.[1]);
  if (!javaMajor || javaMajor < requiredJava) throw new Error(`Minecraft ${entry.id} requires Java ${requiredJava}+; set JAVA_HOME to a matching JDK`);
  console.log(`Downloading Minecraft ${entry.id} and its libraries...`);
  const client = metadata.downloads.client;
  const mappings = metadata.downloads.client_mappings;
  const clientJar = await downloadClient(metadata, directory, values.offline);
  const mappingFile = path.join(directory, `mappings-${mappings.sha1}.txt`);
  const remapper = path.join(cache, `AutoRenamingTool-${ART_VERSION}-all.jar`);
  await download(`https://assets.mcasset.cloud/${encodeURIComponent(entry.id)}/mappings/client.txt`, mappingFile, mappings.sha1, values.offline);
  await download(ART_URL, remapper, ART_SHA1, values.offline);
  const libraries = [];
  const artifacts = [...new Map(metadata.libraries.filter(allowedLibrary)
    .map(library => library.downloads?.artifact).filter(Boolean).map(artifact => [artifact.sha1, artifact])).values()];
  for (let index = 0; index < artifacts.length; index += 6) {
    const results = await Promise.allSettled(artifacts.slice(index, index + 6).map(async artifact => {
      const file = path.join(cache, 'libraries', `${artifact.sha1}.jar`);
      await download(artifact.url, file, artifact.sha1, values.offline);
      return file;
    }));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      libraries.push(result.value);
    }
  }
  const remapKey = sha1(`${client.sha1}:${mappings.sha1}:${ART_SHA1}`);
  const remapped = path.join(directory, `mapped-${remapKey}.jar`);
  const checksum = `${remapped}.sha1`;
  if (await exists(remapped) && await exists(checksum)) {
    if (sha1(await readFile(remapped)) !== (await readFile(checksum, 'utf8')).trim()) throw new Error(`SHA-1 mismatch: ${remapped}`);
  } else {
    console.log(`Remapping Minecraft ${entry.id}...`);
    const temporary = `${remapped}.${process.pid}.tmp.jar`;
    try {
      await run(JAVA, ['-Xmx2G', '-jar', remapper, '--input', clientJar, '--output', temporary,
        '--map', mappingFile, '--reverse', '--ann-fix', '--record-fix', '--strip-sigs', '--threads', '2',
        '--log', path.join(directory, 'remap.log'), ...libraries.flatMap(file => ['--lib', file])]);
      await rename(temporary, remapped);
      await writeFile(checksum, sha1(await readFile(remapped)) + '\n');
    } finally {
      await rm(temporary, { force: true });
    }
  }
  console.log(`Extracting Minecraft ${entry.id}...`);
  const extracted = path.join(directory, `models-${process.pid}.json`);
  try {
    await run(JAVA, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Extract.java', import.meta.url)), extracted], { cwd: directory });
    const { models: records, modelLayers } = JSON.parse(await readFile(extracted, 'utf8'));
    console.log(`Resolving Minecraft ${entry.id} textures...`);
    const textures = await addTextures(records, { jar: remapped, modelLayers, version: entry.id, cache, offline: values.offline });
    await applyTransforms(records, entry.id);
    await applyPasses(records, entry.id, { cache, offline: values.offline });
    const blocks = expandBlocks(await loadBlockFamilies(), records, await listBlockIds(remapped));
    await validateTextures(blockTextureRecords(blocks), entry.id, new Map(), { cache, offline: values.offline });
    await run(JAVA, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Animations.java', import.meta.url)), extracted], { cwd: directory });
    const { animations, findings } = buildAnimations(JSON.parse(await readFile(extracted, 'utf8')), records);
    for (const finding of findings) console.warn(`Animation mapping: ${finding}`);
    const count = await writeDataset(output, entry, records, { blocks, animations });
    await writeFile(path.join(output, '_textures.report.json'), stableStringify(textures.report));
    console.log(`${entry.id}: ${count - animations.length} models, ${animations.length} animation files → ${output}`);
    console.log(`${textures.withTexture} models with a texture; ${textures.withoutTexture} without.`);
  } finally {
    await rm(extracted, { force: true });
  }
}

main().catch(error => {
  console.error(`Error: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
});
