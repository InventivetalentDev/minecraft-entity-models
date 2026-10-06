import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { stableStringify, validateModel } from '../tools/lib.js';
import { applyYUp } from '../tools/y-up.js';

function model(id) {
  return { id, layers: { main: { texture: [64, 64], root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} } } } };
}

test('flags listed models as Y-up and leaves the others without the field', async () => {
  const records = [model('minecraft:chest'), { ...model('minecraft:cow'), yUp: true }, model('other:chest')];
  await applyYUp(records, { chest: 'reason', missing: 'reason' });
  assert.deepEqual(records.map(record => record.yUp), [true, undefined, undefined]);
  assert.equal(Object.hasOwn(records[1], 'yUp'), false);
  assert.match(stableStringify(validateModel(records[0])), /^\{"id":"minecraft:chest","layers":\{.*\},"yUp":true\}\n$/);
});

test('the reviewed list flags unflipped models and skips flipped ones', async () => {
  const ids = ['bell', 'chest', 'creeper_head', 'double_chest_left', 'double_chest_right', 'end_crystal', 'minecart',
    'shulker_box', 'skeleton_skull', 'standing_banner', 'trident', 'zombie'];
  const records = await applyYUp(ids.map(id => model(`minecraft:${id}`)));
  assert.deepEqual(records.filter(record => record.yUp).map(record => record.id.slice(10)),
    ['bell', 'chest', 'double_chest_left', 'double_chest_right', 'end_crystal']);
  const reasons = JSON.parse(await readFile(new URL('../tools/y-up.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(reasons), Object.keys(reasons).sort());
  assert.ok(Object.values(reasons).every(reason => typeof reason === 'string' && reason));
});

test('schema accepts only a true yUp', () => {
  assert.equal(validateModel({ ...model('minecraft:bell'), yUp: true }).yUp, true);
  assert.throws(() => validateModel({ ...model('minecraft:bell'), yUp: false }), /Omit false yUp/);
});
