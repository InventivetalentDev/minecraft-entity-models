import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModel, writeDataset } from './lib.js';

const VERSION = {
  id: '1.16.5',
  type: 'release',
  url: 'https://piston-meta.mojang.com/v1/packages/fba9f7833e858a1257d810d21a3a9e3c967f9077/1.16.5.json',
  time: '2023-06-07T11:09:02+00:00',
  releaseTime: '2021-01-14T16:05:32+00:00',
  sha1: 'fba9f7833e858a1257d810d21a3a9e3c967f9077',
  complianceLevel: 1,
};

function childrenOf(part, id) {
  if (!part || !Array.isArray(part.cubes) || !Array.isArray(part.children)) {
    throw new Error(`Invalid legacy part in ${id}`);
  }
  return part.children;
}

function textureSizes(parts, id) {
  const sizes = new Map();
  function visit(part) {
    const children = childrenOf(part, id);
    if (part.cubes.length) {
      const { textureWidth, textureHeight } = part;
      if (!(textureWidth > 0) || !(textureHeight > 0)) {
        throw new Error(`Invalid legacy texture size in ${id}`);
      }
      sizes.set(`${textureWidth},${textureHeight}`, [textureWidth, textureHeight]);
    }
    children.forEach(visit);
  }
  Object.values(parts).forEach(visit);
  return [...sizes.values()];
}

function sameTexture(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function convertPart(part, id, layerTexture, inheritedTexture = layerTexture) {
  const children = childrenOf(part, id);
  const partTexture = [part.textureWidth, part.textureHeight];
  const overrideTexture = part.cubes.length > 0 && !sameTexture(partTexture, inheritedTexture);
  if (overrideTexture && sameTexture(partTexture, layerTexture)) {
    throw new Error(`Legacy texture inheritance requires a layer-size override in ${id}`);
  }
  const effectiveTexture = overrideTexture ? partTexture : inheritedTexture;
  return {
    ...(overrideTexture ? { texture: partTexture } : {}),
    pose: {
      offset: [part.pivotX, part.pivotY, part.pivotZ],
      rotation: [part.pitch, part.yaw, part.roll],
    },
    cubes: part.cubes.map(cube => ({
      origin: [cube.minX, cube.minY, cube.minZ],
      size: [cube.maxX - cube.minX, cube.maxY - cube.minY, cube.maxZ - cube.minZ],
      uv: [part.textureOffsetU, part.textureOffsetV],
      ...(part.mirror ? { mirror: true } : {}),
    })),
    children: Object.fromEntries(children.map((child, index) => [String(index), convertPart(child, id, layerTexture, effectiveTexture)])),
  };
}

function readModel(id, parts) {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) {
    throw new Error(`Invalid legacy model: ${id}`);
  }
  const sizes = textureSizes(parts, id);
  if (!sizes.length) return { model: null, mixed: false };
  const texture = [Math.max(...sizes.map(size => size[0])), Math.max(...sizes.map(size => size[1]))];
  const model = {
    id: id.includes(':') ? id : `minecraft:${id}`,
    layers: {
      main: {
        texture,
        root: {
          pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
          cubes: [],
          children: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, convertPart(part, id, texture)])),
        },
      },
    },
  };
  validateModel(model);
  return { model, mixed: sizes.length > 1 };
}

export function convertModel(id, parts) {
  return readModel(id, parts).model;
}

export function convertLegacy(entityDump, blockEntityDump) {
  const records = [];
  let skipped = 0;
  let mixedTextureSizes = 0;
  for (const [kind, dump] of [['entity', entityDump], ['block_entity', blockEntityDump]]) {
    if (!dump || typeof dump !== 'object' || Array.isArray(dump)) {
      throw new Error(`Invalid legacy ${kind} dump`);
    }
    for (const [id, parts] of Object.entries(dump)) {
      const { model, mixed } = readModel(id, parts);
      if (!model) {
        skipped++;
        continue;
      }
      if (mixed) mixedTextureSizes++;
      records.push({ kind, model });
    }
  }
  return { records, skipped, mixedTextureSizes };
}

async function main(args) {
  const inputs = [];
  let output;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--output' && !output && args[index + 1] && !args[index + 1].startsWith('--')) {
      output = args[++index];
    } else if (!argument.startsWith('--')) {
      inputs.push(argument);
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }
  if (inputs.length !== 2 || !output) {
    throw new Error('Usage: node tools/convert-legacy.js <entityModels.json> <blockEntityModels.json> --output DIR');
  }
  const dumps = await Promise.all(inputs.map(async input => JSON.parse(await readFile(input, 'utf8'))));
  const { records, skipped, mixedTextureSizes } = convertLegacy(...dumps);
  await writeDataset(output, VERSION, records);
  console.log(`Wrote ${records.length} models to ${output}; skipped ${skipped} empty models; preserved part texture sizes for ${mixedTextureSizes} models with mixed sizes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
