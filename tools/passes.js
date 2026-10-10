import { readFile } from 'node:fs/promises';
import { validateTextures } from './textures.js';
import { versionTexture } from './texture-paths.js';
import { isBabyModel } from './model-ids.js';

// Render modes and the vanilla RenderTypes family each one stands for. `cutout` is the default and is never written to a layer.
export const RENDER_MODES = {
  cutout: 'entityCutoutNoCull',
  cutout_cull: 'entityCutout',
  cutout_z_offset: 'entityCutoutNoCullZOffset',
  solid: 'entitySolid',
  translucent: 'entityTranslucent',
  translucent_emissive: 'entityTranslucentEmissive',
  eyes: 'eyes',
  energy_swirl: 'energySwirl',
  breeze_wind: 'breezeWind',
  water_mask: 'waterMask'
};
// Entries without `since` were checked against the 1.17.1, 1.20.1 and 1.21.11 sources.
// Earlier render modes require an explicit version and supporting evidence in passes.json.
const OLDEST_CHECKED = '1.17';
const LABEL = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const TEXTURE = /^[a-z0-9_.-]+:textures\/[a-z0-9_./-]+\.png$/;

function atLeast(version, since) {
  const [a, b] = [version, since].map(value => value.split('.').map(Number));
  for (let index = 0; index < b.length; index++) {
    if ((a[index] || 0) !== b[index]) return (a[index] || 0) > b[index];
  }
  return true;
}

export function validatePasses(model) {
  for (const [name, layer] of Object.entries(model.layers)) {
    if (!Object.hasOwn(layer, 'render')) continue;
    if (!Object.hasOwn(RENDER_MODES, layer.render) || layer.render === 'cutout') throw new Error(`Invalid render mode for ${name}: ${layer.render}`);
  }
  if (!Object.hasOwn(model, 'passes')) return;
  if (!Array.isArray(model.passes) || model.passes.length === 0) throw new Error('Omit empty passes');
  for (const pass of model.passes) {
    if (!pass || typeof pass !== 'object' || Object.keys(pass).some(key => !['layer', 'textureLocation', 'render', 'when', 'tint'].includes(key))) {
      throw new Error('Expected pass with keys: layer, textureLocation, render, when, tint');
    }
    const layer = Object.hasOwn(model.layers, pass.layer) ? model.layers[pass.layer] : undefined;
    if (!layer) throw new Error(`Pass refers to a missing layer: ${pass.layer}`);
    if (Object.hasOwn(pass, 'textureLocation') && (!TEXTURE.test(pass.textureLocation) || pass.textureLocation === layer.textureLocation)) {
      throw new Error(`Invalid pass texture location: ${pass.textureLocation}`);
    }
    if (Object.hasOwn(pass, 'render') && (!Object.hasOwn(RENDER_MODES, pass.render) || pass.render === (layer.render ?? 'cutout'))) {
      throw new Error(`Invalid pass render mode: ${pass.render}`);
    }
    for (const key of ['when', 'tint']) {
      if (Object.hasOwn(pass, key) && !LABEL.test(pass[key])) throw new Error(`Invalid pass ${key}: ${pass[key]}`);
    }
  }
}

export async function applyRenderModes(records, version, entries) {
  entries ??= JSON.parse(await readFile(new URL('./passes.json', import.meta.url), 'utf8'));
  const byId = new Map(records.map(model => [model.id, model]));
  for (const model of records) for (const layer of Object.values(model.layers)) delete layer.render;
  for (const entry of entries) {
    if (!atLeast(version, entry.since ?? OLDEST_CHECKED)) continue;
    for (const id of entry.ids) {
      const model = byId.get(`minecraft:${id}`);
      if (!model) continue;
      for (const [name, mode] of Object.entries(entry.layers ?? {})) {
        if (Object.hasOwn(model.layers, name)) model.layers[name].render = mode;
      }
    }
  }
  return records;
}

// passes.json lists, per model ID, the layer render modes and the extra draws of the vanilla renderer, with the evidence for each.
// IDs and layers that a version lacks are skipped. Remaining keyword arguments go to validateTextures.
export async function applyPasses(records, version, { entries, textureEntries, ...textureOptions } = {}) {
  entries ??= JSON.parse(await readFile(new URL('./passes.json', import.meta.url), 'utf8'));
  await applyRenderModes(records, version, entries);
  for (const model of records) delete model.passes;
  const byId = new Map(records.map(model => [model.id, model]));
  const textured = [];
  for (const entry of entries) {
    if (!atLeast(version, entry.since ?? OLDEST_CHECKED)) continue;
    for (const id of entry.ids) {
      const model = byId.get(`minecraft:${id}`);
      if (!model) continue;
      if (model.passes) throw new Error(`${model.id}: passes are listed twice`);
      const passes = [];
      for (const { layer: name, textureLocation, render, when, tint } of entry.passes ?? []) {
        if (!Object.hasOwn(model.layers, name)) continue;
        const layer = model.layers[name];
        const pass = { layer: name };
        const texture = versionTexture(textureLocation, isBabyModel(id) || name === 'baby', textureEntries);
        if (texture && texture !== layer.textureLocation) pass.textureLocation = texture;
        if (render && render !== (layer.render ?? 'cutout')) pass.render = render;
        if (when) pass.when = when;
        if (tint) pass.tint = tint;
        passes.push(pass);
      }
      if (passes.length) model.passes = passes;
      try { validatePasses(model); } catch (error) { throw new Error(`${model.id}: ${error.message}`); }
      const layers = Object.fromEntries(passes.flatMap((pass, index) => pass.textureLocation ? [[`passes[${index}]`, { textureLocation: pass.textureLocation }]] : []));
      if (Object.keys(layers).length) textured.push({ id: model.id, layers });
    }
  }
  if (textured.length) await validateTextures(textured, version, new Map(), textureOptions);
  return records;
}
