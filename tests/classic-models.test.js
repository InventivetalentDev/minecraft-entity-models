import assert from 'node:assert/strict';
import test from 'node:test';
import { addClassicBlockModels } from '../tools/classic-models.js';
import { placeLegacyBanners } from '../tools/legacy-blocks.js';
import { expandBlocks, loadBlockFamilies } from '../tools/blocks.js';

function model(id, names) {
  const part = () => ({ pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} });
  return { id: `minecraft:${id}`, transform: [], layers: { main: { texture: [64, 64],
    root: { ...part(), children: Object.fromEntries(names.map(name => [name, part()])) } } } };
}

test('classic block models preserve registered geometry and expose renderer visibility choices', async () => {
  const records = [model('banner', ['pole', 'bar', 'flag']), model('sign/oak', ['sign', 'stick']),
    model('hanging_sign/oak', ['board', 'plank', 'normalChains', 'vChains']), model('shulker', ['base', 'lid', 'head'])];
  const original = structuredClone(records);
  await addClassicBlockModels(records, '1.20.1');
  assert.deepEqual(records.slice(0, original.length), original);
  const get = id => records.find(model => model.id === `minecraft:${id}`);
  assert.deepEqual(Object.keys(get('sign/wall/oak').layers.main.root.children), ['sign']);
  assert.deepEqual(Object.keys(get('hanging_sign/oak/ceiling_middle').layers.main.root.children), ['board', 'vChains']);
  assert.deepEqual(Object.keys(get('shulker_box').layers.main.root.children), ['base', 'lid']);
  assert.deepEqual(Object.keys(get('wall_banner').layers.main.root.children), ['bar']);
  assert.equal(get('standing_banner').layers.flag.root.children.flag.pose.offset[1], -32);
  const legacyBanner = [{ id: 'minecraft:wall_banner' }];
  placeLegacyBanners(legacyBanner);
  assert.deepEqual(get('wall_banner').transform, legacyBanner[0].transform);
  assert.equal(get('wall_banner').transform[0].translate[1], -2.6666667461395264);
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
