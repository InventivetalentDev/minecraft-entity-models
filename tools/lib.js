import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function stableStringify(value) {
  function encode(item) {
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    if (item && typeof item === 'object') {
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  }
  return encode(value) + '\n';
}

export function modelPath(id) {
  if (typeof id !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) {
    throw new Error(`Invalid model id: ${id}`);
  }
  const [namespace, name] = id.split(':');
  if ([namespace, ...name.split('/')].some(part => !part || part === '.' || part === '..') || name.split('/').at(-1) === '_list') {
    throw new Error(`Invalid model id: ${id}`);
  }
  return { namespace, name };
}

function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Expected object with keys: ${required.join(', ')}`);
  }
}

function vector(value, length) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new Error(`Expected ${length} finite numbers`);
  }
}

function part(value, inheritedTexture) {
  object(value, ['pose', 'cubes', 'children'], ['texture']);
  object(value.pose, ['offset', 'rotation'], ['scale']);
  vector(value.pose.offset, 3);
  vector(value.pose.rotation, 3);
  if (Object.hasOwn(value.pose, 'scale')) {
    vector(value.pose.scale, 3);
    if (value.pose.scale.every(number => number === 1)) throw new Error('Omit identity scale');
  }
  if (Object.hasOwn(value, 'texture')) {
    vector(value.texture, 2);
    if (value.texture.some(number => number < 0)) throw new Error('Texture dimensions must be nonnegative');
    if (value.texture.every((number, index) => number === inheritedTexture[index])) throw new Error('Omit part texture matching the inherited size');
  }
  if (!Array.isArray(value.cubes)) throw new Error('Expected cubes array');
  for (const cube of value.cubes) {
    object(cube, ['origin', 'size', 'uv'], ['grow', 'mirror']);
    vector(cube.origin, 3);
    vector(cube.size, 3);
    vector(cube.uv, 2);
    if (Object.hasOwn(cube, 'grow')) {
      vector(cube.grow, 3);
      if (cube.grow.every(number => number === 0)) throw new Error('Omit zero grow');
    }
    if (Object.hasOwn(cube, 'mirror') && cube.mirror !== true) throw new Error('Omit false mirror');
  }
  if (!value.children || typeof value.children !== 'object' || Array.isArray(value.children)) throw new Error('Expected children object');
  for (const child of Object.values(value.children)) part(child, value.texture ?? inheritedTexture);
}

export function validateModel(model) {
  object(model, ['id', 'layers'], ['yUp']);
  if (Object.hasOwn(model, 'yUp') && model.yUp !== true) throw new Error('Omit false yUp');
  modelPath(model.id);
  if (!model.layers || typeof model.layers !== 'object' || Array.isArray(model.layers) || Object.keys(model.layers).length === 0) {
    throw new Error('Expected at least one model layer');
  }
  for (const layer of Object.values(model.layers)) {
    object(layer, ['texture', 'root'], ['textureLocation']);
    if (Object.hasOwn(layer, 'textureLocation')) {
      const { name } = modelPath(layer.textureLocation);
      if (!name.startsWith('textures/') || !name.endsWith('.png')) throw new Error(`Invalid texture location: ${layer.textureLocation}`);
    }
    vector(layer.texture, 2);
    if (layer.texture.some(number => number < 0)) throw new Error('Texture dimensions must be nonnegative');
    part(layer.root, layer.texture);
  }
  return model;
}

export async function writeLists(directory, root = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const files = entries.filter(entry => entry.isFile() && entry.name !== '_list.json' &&
    !(root && entry.name === '_textures.report.json')).map(entry => entry.name).sort();
  for (const name of directories) await writeLists(path.join(directory, name), false);
  await writeFile(path.join(directory, '_list.json'), stableStringify({ directories, files }));
}

export async function writeDataset(output, versionMetadata, records) {
  if (!versionMetadata || typeof versionMetadata.id !== 'string') throw new Error('Missing version id');
  const files = new Map();
  for (const model of records) {
    try { validateModel(model); } catch (error) { throw new Error(`${model?.id}: ${error.message}`); }
    const { namespace, name } = modelPath(model.id);
    const file = path.join(namespace, `${name}.json`);
    if (files.has(file)) throw new Error(`Duplicate model: ${model.id}`);
    files.set(file, stableStringify(model));
  }
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  try {
    await mkdir(output);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output directory already exists: ${output}`);
    throw error;
  }
  await mkdir(path.join(output, 'minecraft'), { recursive: true });
  for (const [file, contents] of files) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), contents);
  }
  await writeFile(path.join(output, 'version.json'), stableStringify(versionMetadata));
  await writeLists(output);
  return files.size;
}
