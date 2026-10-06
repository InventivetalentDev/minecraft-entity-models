import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from './lib.js';

const key = (id, layer) => `${id}#${layer}`;
const javaTool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed: ${errors.trim()}`)));
  });
}

export function pairTextures(dump, records, modelLayers) {
  const classes = [...dump.matchAll(/^(?:(?:public|protected|private|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+([\w.$-]+)/gm)];
  const targets = new Map(records.flatMap(model => Object.entries(model.layers).map(([layer, value]) => [key(model.id, layer), value])));
  const candidates = new Map();
  const report = { pairings: [], unpaired: [] };
  const sources = new Map();
  for (let index = 0; index < classes.length; index++) {
    const text = dump.slice(classes[index].index, classes[index + 1]?.index ?? dump.length);
    const textures = [...new Set([...text.matchAll(/\bldc(?:_w)?\s+#\d+\s+\/\/ String (textures\/entity\/[^\s]+\.png)\s*$/gm)].map(match => `minecraft:${match[1]}`))].sort();
    const fields = [...new Set([...text.matchAll(/\bgetstatic\s+#\d+\s+\/\/ Field net\/minecraft\/client\/model\/geom\/ModelLayers\.([\w$]+):Lnet\/minecraft\/client\/model\/geom\/ModelLayerLocation;/g)].map(match => match[1]))].sort();
    const locations = [...new Set(fields.filter(field => modelLayers[field]).map(field => key(modelLayers[field].id, modelLayers[field].layer)))].sort();
    const unresolved = fields.filter(field => !modelLayers[field]);
    const entry = { className: classes[index][1], modelLayers: locations, textures };
    let reason;
    if (unresolved.length) reason = `Unresolved ModelLayers fields: ${unresolved.join(', ')}`;
    else if (!locations.length || textures.length !== 1) reason = 'Requires model layers and exactly one texture';
    else if (!locations.some(location => targets.has(location))) reason = 'Model layers are absent from the dataset';
    if (reason) {
      report.unpaired.push({ ...entry, reason });
    } else {
      for (const location of locations.filter(location => targets.has(location))) {
        const entries = candidates.get(location) || [];
        entries.push(entry);
        candidates.set(location, entries);
      }
    }
  }
  for (const [location, entries] of candidates) {
    if (new Set(entries.map(entry => entry.textures[0])).size !== 1) {
      report.unpaired.push(...entries.map(entry => ({ ...entry, modelLayers: [location], reason: 'Conflicting textures for the model layer' })));
      continue;
    }
    const textureLocation = entries[0].textures[0];
    targets.get(location).textureLocation = textureLocation;
    sources.set(location, 'pass 1');
    for (const entry of entries) report.pairings.push({ className: entry.className, modelLayer: location, textureLocation });
  }
  for (const entries of Object.values(report)) entries.sort((a, b) => a.className.localeCompare(b.className, 'en')
    || (a.modelLayer || a.modelLayers.join(',')).localeCompare(b.modelLayer || b.modelLayers.join(','), 'en'));
  return { report, sources };
}

export function applyStemTextures(textures, records, sources = new Map()) {
  const stems = new Map();
  for (const texture of [...new Set(textures)].sort()) {
    const location = texture.startsWith('textures/') ? `minecraft:${texture}` : texture;
    const match = /^([a-z0-9_.-]+):textures\/entity\/[a-z0-9_./-]+\.png$/.exec(location);
    if (!match || location.split(/[/:]/).some(part => part === '.' || part === '..')) continue;
    const stem = path.posix.basename(location, '.png');
    const candidates = stems.get(stem) || [];
    if (!candidates.includes(location)) candidates.push(location);
    stems.set(stem, candidates);
  }
  const missing = new Map();
  for (const model of records) {
    const name = model.id.split(':')[1].replace(/_baby$/, '');
    for (const [layer, value] of Object.entries(model.layers)) {
      if (value.textureLocation) continue;
      const stem = layer === 'main' ? name : `${name}_${layer}`;
      const candidates = stems.get(stem) || [];
      const location = key(model.id, layer);
      if (candidates.length === 1) {
        value.textureLocation = candidates[0];
        sources.set(location, 'stem');
      } else {
        missing.set(location, { reason: candidates.length ? `Ambiguous texture stem: ${stem}` : `No exact texture stem: ${stem}`,
          ...(candidates.length ? { candidates } : {}) });
      }
    }
  }
  return missing;
}

async function variants(jar, entries, records, sources) {
  const files = entries.filter(entry => /^data\/minecraft\/[a-z0-9_]+_variant\/[a-z0-9_.-]+\.json$/.test(entry));
  if (!files.length) return;
  const directory = await mkdtemp(path.join(tmpdir(), 'minecraft-model-variants-'));
  try {
    await run(javaTool('jar'), ['xf', path.resolve(jar), ...files], directory);
    const grouped = new Map();
    for (const file of files.sort()) {
      const [, name, variant] = /^data\/minecraft\/([a-z0-9_]+)_variant\/([a-z0-9_.-]+)\.json$/.exec(file);
      const data = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      const asset = data.asset_id ?? data.assets?.wild;
      const options = grouped.get(name) || [];
      options.push({ variant, asset });
      grouped.set(name, options);
    }
    const preference = name => name === 'temperate' ? 0 : name === 'pale' ? 1 : 2;
    for (const [name, options] of grouped) {
      options.sort((a, b) => preference(a.variant) - preference(b.variant) || a.variant.localeCompare(b.variant, 'en'));
      const asset = options[0].asset;
      if (typeof asset !== 'string') continue;
      const [namespace, assetPath] = asset.includes(':') ? asset.split(':') : ['minecraft', asset];
      const textureLocation = `${namespace}:textures/${assetPath}.png`;
      for (const model of records.filter(model => model.id === `minecraft:${name}` || model.id === `minecraft:${name}_baby`)) {
        for (const layer of ['main', 'baby']) {
          if (!model.layers[layer]) continue;
          model.layers[layer].textureLocation = textureLocation;
          sources.set(key(model.id, layer), 'variant');
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// An equipment asset names the texture of the model sharing its ID, such as the elytra.
export function applyEquipmentTextures(equipment, records, sources = new Map()) {
  for (const model of records) {
    const main = model.layers.main;
    const types = Object.entries(equipment[model.id]?.layers ?? {});
    if (!main || main.textureLocation || types.length !== 1 || types[0][1].length !== 1) continue;
    const [type, [{ texture }]] = types[0];
    if (typeof texture !== 'string') continue;
    const [namespace, assetPath] = texture.includes(':') ? texture.split(':') : ['minecraft', texture];
    main.textureLocation = `${namespace}:textures/entity/equipment/${type}/${assetPath}.png`;
    sources.set(key(model.id, 'main'), 'equipment');
  }
}

async function equipment(jar, entries, records, sources) {
  const files = entries.filter(entry => /^assets\/minecraft\/equipment\/[a-z0-9_.-]+\.json$/.test(entry));
  if (!files.length) return;
  const directory = await mkdtemp(path.join(tmpdir(), 'minecraft-model-equipment-'));
  try {
    await run(javaTool('jar'), ['xf', path.resolve(jar), ...files], directory);
    const assets = {};
    for (const file of files) assets[`minecraft:${path.basename(file, '.json')}`] = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    applyEquipmentTextures(assets, records, sources);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function extractTextures({ jar, records, modelLayers }) {
  let result = { report: { pairings: [], unpaired: [] }, sources: new Map() };
  let entries = [];
  if (modelLayers) {
    entries = (await run(javaTool('jar'), ['tf', jar])).trim().split(/\r?\n/);
    const classes = entries.filter(entry => /^net\/minecraft\/client\/renderer\/(?:entity|blockentity)\/.*\.class$/.test(entry))
      .map(entry => entry.slice(0, -6).replaceAll('/', '.')).sort();
    const dumps = [];
    for (let index = 0; index < classes.length; index += 40) {
      dumps.push(await run(javaTool('javap'), ['-c', '-p', '-classpath', jar, ...classes.slice(index, index + 40)]));
    }
    result = pairTextures(dumps.join('\n'), records, modelLayers);
  }
  const strings = (await run(javaTool('java'), [fileURLToPath(new URL('./TextureStrings.java', import.meta.url)), jar])).trim().split(/\r?\n/);
  result.missing = applyStemTextures(strings, records, result.sources);
  if (modelLayers) {
    await variants(jar, entries, records, result.sources);
    await equipment(jar, entries, records, result.sources);
  }
  return result;
}

function patternMatcher(pattern) {
  const names = [];
  let expression = '';
  let start = 0;
  for (const match of pattern.matchAll(/\{([A-Za-z]\w*)\}|\*/g)) {
    expression += pattern.slice(start, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expression += '([a-z0-9_.-]+)';
    names.push(match[1]);
    start = match.index + match[0].length;
  }
  expression += pattern.slice(start).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { expression: new RegExp(`^${expression}$`), names };
}

export async function applyOverrides(records, { sources = new Map(), overrides } = {}) {
  overrides ??= JSON.parse(await readFile(new URL('./texture-overrides.json', import.meta.url), 'utf8'));
  function apply(model, value, captures = {}) {
    if (value !== null && typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`Invalid texture override for ${model.id}`);
    }
    const layers = value === null ? Object.fromEntries(Object.keys(model.layers).map(layer => [layer, null]))
      : typeof value === 'string' ? { main: value } : value;
    for (const [name, texture] of Object.entries(layers)) {
      if (!model.layers[name]) continue;
      const location = key(model.id, name);
      if (texture !== null && typeof texture !== 'string') throw new Error(`Invalid texture override for ${location}`);
      if (texture === null) {
        delete model.layers[name].textureLocation;
        sources.set(location, 'null override');
      } else {
        model.layers[name].textureLocation = texture.replace(/\{([A-Za-z]\w*)\}/g, (_, name) => {
          if (!(name in captures)) throw new Error(`Unknown texture pattern variable: ${name}`);
          return captures[name];
        });
        sources.set(location, 'override');
      }
    }
  }
  for (const [pattern, value] of Object.entries(overrides.pattern || {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const { expression, names } = patternMatcher(pattern.includes(':') ? pattern : `minecraft:${pattern}`);
    for (const model of records) {
      const match = expression.exec(model.id);
      if (!match) continue;
      const captures = {};
      let consistent = true;
      names.forEach((name, index) => {
        if (!name) return;
        if (name in captures && captures[name] !== match[index + 1]) consistent = false;
        captures[name] = match[index + 1];
      });
      if (consistent) apply(model, value, captures);
    }
  }
  const byId = new Map(records.map(model => [model.id, model]));
  for (const [id, value] of Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (id === 'pattern') continue;
    const model = byId.get(id.includes(':') ? id : `minecraft:${id}`);
    if (model) apply(model, value);
  }
  return sources;
}

export function inheritBabyTextures(records, sources) {
  const byId = new Map(records.map(model => [model.id, model]));
  for (const model of [...records].sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id, 'en'))) {
    for (const [layer, value] of Object.entries(model.layers)) {
      const location = key(model.id, layer);
      if (['override', 'null override'].includes(sources.get(location))) continue;
      const parent = model.id.endsWith('_baby') ? byId.get(model.id.slice(0, -5)) : layer === 'baby' ? model : null;
      const parentLayer = parent === model ? 'main' : layer;
      const parentValue = parent?.layers[parentLayer];
      if (!parentValue) continue;
      const parentKey = key(parent.id, parentLayer);
      if (['null override', 'inherited null override'].includes(sources.get(parentKey))) {
        delete value.textureLocation;
        sources.set(location, 'inherited null override');
      } else if (parentValue.textureLocation) {
        value.textureLocation = parentValue.textureLocation;
        sources.set(location, `inherited ${parentKey} (${sources.get(parentKey)})`);
      }
    }
  }
}

export async function validateTextures(records, version, sources, { cache = '.cache/minecraft-entity-models', offline = false, fetch = globalThis.fetch } = {}) {
  const requests = new Map();
  for (const model of [...records].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    for (const [layer, value] of Object.entries(model.layers).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      if (!Object.hasOwn(value, 'textureLocation')) continue;
      const location = key(model.id, layer);
      const source = sources.get(location) || 'existing';
      const texture = value.textureLocation;
      const match = typeof texture === 'string' && /^([a-z0-9_.-]+):(textures\/[a-z0-9_./-]+\.png)$/.exec(texture);
      if (!match || [match[1], ...match[2].split('/')].some(part => !part || part === '.' || part === '..')) {
        throw new Error(`${location} (${source}): invalid texture location ${texture}`);
      }
      const url = `https://assets.mcasset.cloud/${encodeURIComponent(version)}/assets/${match[1]}/${match[2]}`;
      if (!requests.has(url)) requests.set(url, `${location} (${source})`);
    }
  }
  const filename = path.join(cache, version, 'texture-heads.json');
  let cached = new Set();
  try {
    cached = new Set(JSON.parse(await readFile(filename, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = [...requests];
  for (let index = 0; index < entries.length; index += 8) {
    const results = await Promise.allSettled(entries.slice(index, index + 8).map(async ([url, label]) => {
      if (offline) {
        if (!cached.has(url)) throw new Error(`${label}: offline texture cache miss: ${url}`);
        return;
      }
      let response;
      try {
        response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
      } catch (error) {
        throw new Error(`${label}: texture HEAD failed: ${url}: ${error.message}`);
      }
      if (!response.ok) throw new Error(`${label}: texture HEAD returned ${response.status}: ${url}`);
      cached.add(url);
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  if (!offline && requests.size) {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, stableStringify([...cached].sort()));
  }
}

export async function addTextures(records, { jar, modelLayers, version, cache, offline } = {}) {
  for (const model of records) for (const value of Object.values(model.layers)) delete value.textureLocation;
  const { report, sources, missing } = jar ? await extractTextures({ jar, records, modelLayers })
    : { report: { pairings: [], unpaired: [] }, sources: new Map(), missing: applyStemTextures([], records) };
  await applyOverrides(records, { sources });
  inheritBabyTextures(records, sources);
  report.missing = [];
  for (const model of [...records].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    for (const [layer, value] of Object.entries(model.layers).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      if (value.textureLocation) continue;
      const location = key(model.id, layer);
      const source = sources.get(location);
      const reason = source === 'null override' ? { reason: 'Explicit null override' }
        : source === 'inherited null override' ? { reason: 'Parent layer excluded by null override' }
          : missing.get(location) || { reason: 'No texture assigned by renderer, stem, variant, or override' };
      report.missing.push({ id: model.id, layer, ...reason });
    }
  }
  await validateTextures(records, version, sources, { cache, offline });
  const withTexture = records.filter(model => Object.values(model.layers).some(layer => layer.textureLocation)).length;
  return { report, withTexture, withoutTexture: records.length - withTexture };
}
