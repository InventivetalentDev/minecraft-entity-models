import { readFile } from 'node:fs/promises';

const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const TEXTURE = /^[a-z0-9_.-]+:textures\/[a-z0-9_./-]+\.png$/;
const VALUE = /^[a-z0-9_]+(\|[a-z0-9_]+)*$/;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
}

function keys(value, required, optional = []) {
  plain(value);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new Error(`Unexpected ${key}`);
}

function validateEntry(entry) {
  keys(entry, ['parts'], ['rotation', 'translation']);
  if (!Array.isArray(entry.parts) || entry.parts.length === 0) throw new Error('Expected at least one part');
  for (const part of entry.parts) {
    keys(part, ['model'], ['layer', 'textureLocation', 'when']);
    if (typeof part.model !== 'string' || !ID.test(part.model)) throw new Error(`Invalid model: ${part.model}`);
    if (Object.hasOwn(part, 'layer') && (typeof part.layer !== 'string' || !part.layer || part.layer === 'main')) throw new Error('Omit the main layer');
    if (Object.hasOwn(part, 'textureLocation') && (typeof part.textureLocation !== 'string' || !TEXTURE.test(part.textureLocation))) {
      throw new Error(`Invalid texture location: ${part.textureLocation}`);
    }
    if (Object.hasOwn(part, 'when')) {
      plain(part.when);
      const conditions = Object.entries(part.when);
      if (conditions.length === 0) throw new Error('Omit empty when');
      for (const [property, value] of conditions) {
        if (!/^[a-z0-9_]+$/.test(property) || typeof value !== 'string' || !VALUE.test(value)) throw new Error(`Invalid condition: ${property}`);
      }
    }
  }
  if (Object.hasOwn(entry, 'rotation')) {
    const rotation = entry.rotation;
    keys(rotation, ['property'], ['degrees', 'step']);
    if (typeof rotation.property !== 'string' || !/^[a-z0-9_]+$/.test(rotation.property)) throw new Error('Invalid rotation property');
    if (Object.hasOwn(rotation, 'degrees') === Object.hasOwn(rotation, 'step')) throw new Error('Expected rotation degrees or step');
    if (Object.hasOwn(rotation, 'step')) {
      if (!Number.isFinite(rotation.step) || rotation.step === 0) throw new Error('Invalid rotation step');
    } else {
      plain(rotation.degrees);
      const values = Object.entries(rotation.degrees);
      if (values.length === 0 || values.some(([name, degrees]) => !/^[a-z0-9_]+$/.test(name) || !Number.isFinite(degrees) || degrees < 0 || degrees >= 360)) {
        throw new Error('Invalid rotation degrees');
      }
    }
  }
  if (Object.hasOwn(entry, 'translation')) {
    const translation = entry.translation;
    if (!Array.isArray(translation) || translation.length !== 3 || translation.some(number => !Number.isFinite(number)) || translation.every(number => number === 0)) {
      throw new Error('Invalid translation');
    }
  }
}

export function validateBlocks(index) {
  plain(index);
  for (const [block, entry] of Object.entries(index)) {
    try {
      if (!ID.test(block)) throw new Error('Invalid block id');
      validateEntry(entry);
    } catch (error) {
      throw new Error(`${block}: ${error.message}`);
    }
  }
  return index;
}

function fill(template, values) {
  return template.replace(/\{([a-z]+)(?:\.([a-z]+))?\}/g, (match, set, field) => {
    const value = field === undefined ? values[set] : values[set]?.[field];
    if (typeof value !== 'string') throw new Error(`Unknown placeholder ${match}`);
    return value;
  });
}

// Expands the reviewed block families into the index for one version: parts whose model or layer is not in
// `records` are dropped, as are blocks outside `blockIds` (when given) and blocks left without parts.
export function expandBlocks(data, records, blockIds) {
  const models = new Map(records.map(model => [model.id, model.layers]));
  const index = {};
  for (const family of data.families) {
    let combinations = [{}];
    for (const name of family.each ?? []) {
      if (!Array.isArray(data.sets[name])) throw new Error(`Unknown set: ${name}`);
      combinations = combinations.flatMap(values => data.sets[name].map(value => ({ ...values, [name]: value })));
    }
    for (const values of combinations) {
      const block = `minecraft:${fill(family.block, values)}`;
      if (Object.hasOwn(index, block)) throw new Error(`Duplicate block: ${block}`);
      if (blockIds && !blockIds.has(block)) continue;
      const parts = [];
      for (const source of family.parts) {
        const part = { model: `minecraft:${fill(source.model, values)}` };
        const layer = models.get(part.model)?.[source.layer ?? 'main'];
        if (!layer) continue;
        if (source.layer) part.layer = source.layer;
        if (source.texture) {
          const texture = `minecraft:textures/entity/${fill(source.texture, values)}.png`;
          if (texture !== layer.textureLocation) part.textureLocation = texture;
        }
        if (source.when) part.when = source.when;
        parts.push(part);
      }
      if (parts.length === 0) continue;
      const entry = { parts };
      if (family.rotation) {
        if (!data.rotations[family.rotation]) throw new Error(`Unknown rotation: ${family.rotation}`);
        entry.rotation = data.rotations[family.rotation];
      }
      if (family.translation) entry.translation = family.translation;
      index[block] = entry;
    }
  }
  return validateBlocks(index);
}

// Pseudo-records that let validateTextures check the index's texture locations.
export function blockTextureRecords(index) {
  return Object.entries(index).map(([block, entry]) => ({
    id: `blocks.json ${block}`,
    layers: Object.fromEntries(entry.parts.filter(part => part.textureLocation).map((part, number) => [`part ${number}`, part]))
  }));
}

export async function loadBlockFamilies() {
  return JSON.parse(await readFile(new URL('./block-families.json', import.meta.url), 'utf8'));
}

// Block IDs of a version, taken from the blockstate files among its client jar entries.
export function listBlockIds(entries) {
  return new Set(entries.flatMap(entry => {
    const match = /^assets\/minecraft\/blockstates\/([a-z0-9_]+)\.json$/.exec(entry);
    return match ? [`minecraft:${match[1]}`] : [];
  }));
}
