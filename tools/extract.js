import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify, writeDataset } from './lib.js';
import { blockTextureRecords, expandBlocks, listBlockIds, loadBlockFamilies } from './blocks.js';
import { addTextures, validateTextures } from './textures.js';
import { applyTransforms } from './transform.js';
import { applyPasses } from './passes.js';
import { buildAnimations } from './animations.js';
import { extractionAdapter } from './extraction-adapters.js';
import { addClassicBlockModels } from './classic-models.js';
import { proceduralAnimations } from './procedural-animations.js';
import { decimateProceduralAnimations } from './procedural-decimation.js';
import { DEFAULT_CACHE, clientNeedsRemapping, download, downloadClient, exists, loadVersion, sha1 } from './download.js';
import { downloadLibraries, javaTool, listJar } from './runtime.js';

const ART_VERSION = '2.0.18';
const ART_SHA1 = '59bd788e0a1bd339256711dee40015a62cdf3cd2';
const ART_URL = `https://maven.neoforged.net/releases/net/neoforged/AutoRenamingTool/${ART_VERSION}/AutoRenamingTool-${ART_VERSION}-all.jar`;
const JAVA = javaTool('java');

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
  const adapter = extractionAdapter(entry.id);
  if (/^1\.(\d+)/.test(entry.id) && Number(entry.id.match(/^1\.(\d+)/)[1]) < 17) {
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
  const clientEntries = mappings ? null : await listJar(clientJar);
  const remap = clientNeedsRemapping(metadata, clientEntries ?? []);
  const mappingFile = mappings && path.join(directory, `mappings-${mappings.sha1}.txt`);
  const remapper = path.join(cache, `AutoRenamingTool-${ART_VERSION}-all.jar`);
  if (remap) {
    await download(`https://assets.mcasset.cloud/${encodeURIComponent(entry.id)}/mappings/client.txt`, mappingFile, mappings.sha1, values.offline);
    await download(ART_URL, remapper, ART_SHA1, values.offline);
  }
  const libraries = await downloadLibraries(metadata.libraries, cache, values.offline);
  const remapKey = remap && sha1(`${client.sha1}:${mappings.sha1}:${ART_SHA1}`);
  const remapped = remap ? path.join(directory, `mapped-${remapKey}.jar`) : clientJar;
  const checksum = `${remapped}.sha1`;
  if (remap && await exists(remapped) && await exists(checksum)) {
    if (sha1(await readFile(remapped)) !== (await readFile(checksum, 'utf8')).trim()) throw new Error(`SHA-1 mismatch: ${remapped}`);
  } else if (remap) {
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
  const entries = clientEntries ?? await listJar(remapped);
  const extracted = path.join(directory, `models-${process.pid}.json`);
  const proceduralInputs = path.join(directory, `animation-inputs-${process.pid}.json`);
  try {
    await run(JAVA, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Extract.java', import.meta.url)), extracted], { cwd: directory });
    const { models: records, modelLayers } = JSON.parse(await readFile(extracted, 'utf8'));
    adapter.normalizeModels(records);
    await applyTransforms(records, entry.id);
    await addClassicBlockModels(records, entry.id);
    console.log(`Resolving Minecraft ${entry.id} textures...`);
    const textures = await addTextures(records, { jar: remapped, entries, modelLayers, version: entry.id, cache, offline: values.offline });
    await applyPasses(records, entry.id, { cache, offline: values.offline, textureEntries: textures.textureEntries });
    const blocks = expandBlocks(await loadBlockFamilies(), records, listBlockIds(entries));
    await validateTextures(blockTextureRecords(blocks), entry.id, new Map(), { cache, offline: values.offline });
    await run(JAVA, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Animations.java', import.meta.url)), extracted], { cwd: directory });
    const native = JSON.parse(await readFile(extracted, 'utf8'));
    const dump = adapter.nativeAnimations(native);
    const procedural = proceduralAnimations(entry.id, records);
    if (!adapter.procedural) {
      console.warn(`Minecraft ${entry.id} has no reviewed procedural animation profiles; only native definitions are extracted.`);
    }
    if (procedural.length) {
      console.log(`Sampling Minecraft ${entry.id} procedural animations...`);
      const samplerLibraries = [...libraries, ...await downloadLibraries(adapter.samplerLibraries, cache, values.offline)];
      await writeFile(proceduralInputs, JSON.stringify(procedural));
      await run(JAVA, ['-Djava.awt.headless=true', '--class-path', [remapped, ...samplerLibraries].join(path.delimiter),
        fileURLToPath(new URL('./ProceduralAnimations.java', import.meta.url)), proceduralInputs, extracted], { cwd: directory });
      dump.push(...decimateProceduralAnimations(JSON.parse(await readFile(extracted, 'utf8'))));
    }
    const { animations, findings } = buildAnimations(dump, records);
    for (const finding of findings) console.warn(`Animation mapping: ${finding}`);
    const count = await writeDataset(output, entry, records, { blocks, animations });
    await writeFile(path.join(output, '_textures.report.json'), stableStringify(textures.report));
    console.log(`${entry.id}: ${count - animations.length} models, ${animations.length} animation files → ${output}`);
    console.log(`${textures.withTexture} models with a texture; ${textures.withoutTexture} without.`);
  } finally {
    await rm(extracted, { force: true });
    await rm(proceduralInputs, { force: true });
  }
}

main().catch(error => {
  console.error(`Error: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
});
