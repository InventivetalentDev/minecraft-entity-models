import assert from 'node:assert/strict';
import test from 'node:test';
import { addClassicBlockModels } from '../tools/classic-models.js';
import { addLegacyBlockLayers } from '../tools/legacy-blocks.js';
import { expandBlocks, loadBlockFamilies } from '../tools/blocks.js';
import { applyTransforms } from '../tools/transform.js';
import { addTextures } from '../tools/textures.js';
import { applyPasses } from '../tools/passes.js';

function model(id, names) {
  const part = () => ({ pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} });
  return { id: `minecraft:${id}`, transform: [], layers: { main: { texture: [64, 64],
    root: { ...part(), children: Object.fromEntries(names.map(name => [name, part()])) } } } };
}

test('classic block models preserve registered geometry and expose renderer visibility choices', async () => {
  const records = [model('banner', ['pole', 'bar', 'flag']), model('sign/oak', ['sign', 'stick']),
    model('hanging_sign/oak', ['board', 'plank', 'normalChains', 'vChains']), model('shulker', ['base', 'lid', 'head'])];
  await applyTransforms(records, '1.20.1');
  const original = structuredClone(records);
  await addClassicBlockModels(records, '1.20.1');
  assert.deepEqual(records.slice(0, original.length), original);
  const get = id => records.find(model => model.id === `minecraft:${id}`);
  assert.deepEqual(Object.keys(get('sign/wall/oak').layers.main.root.children), ['sign']);
  assert.deepEqual(Object.keys(get('hanging_sign/oak/ceiling_middle').layers.main.root.children), ['board', 'vChains']);
  assert.deepEqual(Object.keys(get('shulker_box').layers.main.root.children), ['base', 'lid']);
  assert.deepEqual(Object.keys(get('wall_banner').layers.main.root.children), ['bar']);
  assert.equal(get('standing_banner').layers.flag.root.children.flag.pose.offset[1], -32);
  assert.deepEqual(get('standing_banner').transform, get('banner').transform);
  const legacyBanner = [{ id: 'minecraft:wall_banner' }];
  await applyTransforms(legacyBanner, '1.16.5');
  assert.deepEqual(get('wall_banner').transform, legacyBanner[0].transform);
  assert.equal(get('wall_banner').transform[0].translate[1], -2.6666667461395264);
  const placed = structuredClone(records.map(({ id, transform, layers }) => ({ id, transform,
    roots: Object.values(layers).map(layer => layer.root) })));
  const textures = await addTextures(records, { version: '1.20.1', validate: false });
  await applyPasses(records, '1.20.1');
  assert.equal(textures.withTexture, records.length);
  assert.deepEqual(textures.report.missing, []);
  assert.equal(get('sign/wall/oak').layers.main.textureLocation, 'minecraft:textures/entity/signs/oak.png');
  assert.equal(get('standing_banner').layers.flag.render, 'solid');
  assert.equal(get('shulker_box').layers.main.render, undefined);
  assert.equal(get('shulker').layers.main.render, 'cutout_z_offset');
  assert.deepEqual(records.map(({ id, transform, layers }) => ({ id, transform,
    roots: Object.values(layers).map(layer => layer.root) })), placed);
  const blocks = expandBlocks(await loadBlockFamilies(), records);
  for (const id of ['oak_sign', 'oak_wall_sign', 'oak_hanging_sign', 'oak_wall_hanging_sign', 'red_banner', 'red_wall_banner', 'shulker_box']) {
    assert.ok(blocks[`minecraft:${id}`], id);
  }
  const once = structuredClone(records);
  await addClassicBlockModels(records, '1.20.1');
  assert.deepEqual(records, once);
  const modern = structuredClone(original);
  await addClassicBlockModels(modern, '1.21.11');
  assert.deepEqual(modern, original);
});

test('legacy block indexes use textures assigned after their geometry aliases exist', async () => {
  const chestParts = ['singleChest', 'doubleChestLeft', 'doubleChestRight'].flatMap(prefix =>
    ['Lid', 'Base', 'Latch'].map(part => `${prefix}${part}`));
  const records = [
    model('chest', chestParts), model('trapped_chest', chestParts), model('ender_chest', chestParts),
    model('bed', ['field_20813', 'field_20814', 'legs_0', 'legs_1', 'legs_2', 'legs_3']),
    model('sign', ['field', 'foot']), model('banner', ['pillar', 'crossbar', 'banner']),
    model('conduit', ['field_20825']), model('shulker_box', ['bottomShell', 'topShell']),
  ];
  const blockIds = new Set(['minecraft:chest', 'minecraft:shulker_box', 'minecraft:oak_sign']);
  const families = await addLegacyBlockLayers(records, blockIds);
  const get = id => records.find(record => record.id === `minecraft:${id}`);
  get('chest').layers.single.textureLocation = 'minecraft:textures/entity/chest/normal.png';
  get('shulker_box').layers.shell.textureLocation = 'minecraft:textures/entity/shulker/shulker.png';
  get('sign/standing/oak').layers.main.textureLocation = 'minecraft:textures/entity/signs/oak.png';
  for (const id of ['chest', 'trapped_chest', 'ender_chest']) {
    assert.deepEqual(Object.keys(get(id).layers.single.root.children), ['singleChestLid', 'singleChestBase', 'singleChestLatch']);
    assert.equal(Object.keys(get(id).layers.main.root.children).length, 9);
  }
  const blocks = expandBlocks(families, records, blockIds);
  assert.deepEqual(blocks['minecraft:shulker_box'].parts, [{ model: 'minecraft:shulker_box', layer: 'shell' }]);
  assert.deepEqual(blocks['minecraft:oak_sign'].parts, [{ model: 'minecraft:sign/standing/oak' }]);
  const singleChest = blocks['minecraft:chest'].parts.find(part => part.layer === 'single');
  assert.equal(singleChest.model, 'minecraft:chest');
  assert.equal(singleChest.textureLocation, undefined);
});
