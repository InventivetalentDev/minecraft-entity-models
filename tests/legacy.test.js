import assert from 'node:assert/strict';
import test from 'node:test';
import { addLegacyRuntimeLayers, convertLegacy, convertModel } from '../tools/convert-legacy.js';
import { validateModel } from '../tools/lib.js';
import { applyLegacyPasses } from '../tools/legacy-passes.js';

test('converts a legacy trident with a mirrored child to one main layer', () => {
  const part = {
    textureWidth: 32,
    textureHeight: 32,
    textureOffsetU: 0,
    textureOffsetV: 6,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    mirror: false,
    cubes: [{ minX: -0.5, minY: 2, minZ: -0.5, maxX: 0.5, maxY: 27, maxZ: 0.5 }],
    children: [],
  };
  part.children.push({
    ...part,
    textureOffsetU: 4,
    textureOffsetV: 3,
    pivotX: 1,
    pivotY: 2,
    pivotZ: 3,
    pitch: 0.25,
    yaw: -0.5,
    roll: 1,
    mirror: true,
    cubes: [{ minX: 1.5, minY: -3, minZ: -0.5, maxX: 2.5, maxY: 1, maxZ: 0.5 }],
    children: [],
  });
  const model = convertModel('minecraft:trident', { trident: part });
  assert.equal(model.id, 'minecraft:trident');
  assert.deepEqual(Object.keys(model.layers), ['main']);
  assert.deepEqual(model.layers.main.texture, [32, 32]);
  assert.deepEqual(model.layers.main.root.pose, { offset: [0, 0, 0], rotation: [0, 0, 0] });
  const converted = model.layers.main.root.children.trident;
  assert.deepEqual(converted.cubes, [{ origin: [-0.5, 2, -0.5], size: [1, 25, 1], uv: [0, 6] }]);
  assert.deepEqual(converted.children['0'], {
    pose: { offset: [1, 2, 3], rotation: [0.25, -0.5, 1] },
    cubes: [{ origin: [1.5, -3, -0.5], size: [1, 4, 1], uv: [4, 3], mirror: true }],
    children: {},
  });
  assert.deepEqual(convertLegacy({ 'minecraft:trident': { trident: part } }, {}), {
    records: [model],
    skipped: 0,
    mixedTextureSizes: 0,
  });
});

test('inherits and resets a legacy part texture override through its children', () => {
  const part = {
    textureWidth: 16,
    textureHeight: 16,
    textureOffsetU: 0,
    textureOffsetV: 0,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }],
    children: [],
  };
  const model = convertModel('minecraft:conduit', {
    shell: { ...part, textureWidth: 64, textureHeight: 32 },
    eye: {
      ...part,
      children: [
        { ...part, children: [] },
        {
          ...part,
          textureWidth: 64,
          textureHeight: 32,
          children: [{ ...part, textureWidth: 64, textureHeight: 32, children: [] }],
        },
      ],
    },
  });
  assert.deepEqual(model.layers.main.texture, [64, 32]);
  assert.equal(Object.hasOwn(model.layers.main.root.children.shell, 'texture'), false);
  assert.deepEqual(model.layers.main.root.children.eye.texture, [16, 16]);
  assert.equal(Object.hasOwn(model.layers.main.root.children.eye.children['0'], 'texture'), false);
  const reset = model.layers.main.root.children.eye.children['1'];
  assert.deepEqual(reset.texture, [64, 32]);
  assert.equal(Object.hasOwn(reset.children['0'], 'texture'), false);
  assert.equal(convertModel('minecraft:beacon', {}), null);
});


test('adds animation hierarchies without changing legacy part names or geometry', () => {
  const part = {
    textureWidth: 16, textureHeight: 16, textureOffsetU: 0, textureOffsetV: 0,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }], children: [],
  };
  const parent = { ...part, children: [{ ...part, name: 'tail' }] };
  const original = convertModel('example:mob', { body: parent });
  const expected = structuredClone(original);
  const records = [original];
  addLegacyRuntimeLayers(records, { 'example:mob': { main: { body: { ...parent, pivotY: 24 } }, animated: { body: parent } } });
  assert.deepEqual(original.layers.main, expected.layers.main);
  assert.deepEqual(Object.keys(original.layers.main.root.children.body.children), ['0']);
  assert.deepEqual(Object.keys(original.layers.animated.root.children.body.children), ['tail']);
  assert.equal(original.passes, undefined);
});

test('uses recovered per-cube UV, dilation and mirror for newly extracted parts', () => {
  const part = {
    textureWidth: 64, textureHeight: 32, textureOffsetU: 20, textureOffsetV: 25,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: true,
    cubes: [
      { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 3, maxZ: 4, uv: [3, 5], grow: [1, 2, 3], mirror: false },
      { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 3, maxZ: 4, uv: [20, 25], grow: [0, 0, 0], mirror: true },
    ], children: [],
  };
  const cubes = convertModel('example:armor', { body: part }).layers.main.root.children.body.cubes;
  assert.deepEqual(cubes[0], { origin: [0, 0, 0], size: [2, 3, 4], uv: [3, 5], grow: [1, 2, 3] });
  assert.deepEqual(cubes[1], { origin: [0, 0, 0], size: [2, 3, 4], uv: [20, 25], mirror: true });
});


test('rebases runtime part texture inheritance onto the preserved legacy layer size', () => {
  const part = {
    textureWidth: 16, textureHeight: 16, textureOffsetU: 0, textureOffsetV: 0,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }], children: [],
  };
  const record = convertModel('example:mob', { body: part });
  const original = structuredClone(record.layers.main.root.children.body);
  const large = { ...part, textureWidth: 64, textureHeight: 32 };
  const small = { ...part, children: [{ ...large, children: [part] }] };
  addLegacyRuntimeLayers([record], { 'example:mob': { main: { body: large, small, large } } });
  assert.deepEqual(record.layers.main.texture, [16, 16]);
  assert.deepEqual(record.layers.main.root.children.body, original);
  const added = record.layers.main.root.children;
  assert.equal(Object.hasOwn(added.small, 'texture'), false);
  assert.deepEqual(added.small.children['0'].texture, [64, 32]);
  assert.deepEqual(added.small.children['0'].children['0'].texture, [16, 16]);
  assert.deepEqual(added.large.texture, [64, 32]);
  assert.doesNotThrow(() => validateModel({ ...record, transform: [] }));
});

test('preserves runtime models with non-main layers through legacy pass assignment', () => {
  const part = {
    textureWidth: 16, textureHeight: 16, textureOffsetU: 0, textureOffsetV: 0,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }], children: [],
  };
  for (const [id, layer] of [
    ['armor_stand', 'animated'], ['shulker', 'animated'], ['trident', 'animated'],
    ['player', 'animated'], ['wolf', 'animated'], ['creeper', 'animated'], ['conduit', 'animated'],
    ['conduit', 'shell'], ['chest', 'single'], ['sheep', 'fur'],
  ]) {
    const records = [];
    addLegacyRuntimeLayers(records, { [`minecraft:${id}`]: { main: {}, [layer]: { body: part } } });
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0].layers), [layer]);
    const geometry = structuredClone(records[0].layers[layer].root);
    applyLegacyPasses(records);
    assert.deepEqual(Object.keys(records[0].layers), [layer]);
    assert.deepEqual(records[0].layers[layer].root, geometry);
    assert.doesNotThrow(() => validateModel({ ...records[0], transform: [] }));
    if (id === 'sheep') assert.deepEqual(records[0].passes, [{ layer: 'fur', when: 'not_sheared', tint: 'wool_color' }]);
    else assert.equal(records[0].passes, undefined);
    if (id === 'conduit' && layer === 'shell') assert.equal(records[0].layers.shell.render, 'solid');
    if (id === 'chest') assert.equal(records[0].layers.single.render, 'cutout_cull');
  }
  const mainOnly = convertModel('minecraft:sheep', { body: part });
  assert.throws(() => applyLegacyPasses([mainOnly]), /minecraft:sheep: missing feature layer fur/);
});
