import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { stableStringify, validateModel } from '../tools/lib.js';
import { applyTransforms, validateTransform } from '../tools/transform.js';

const LIVING = [{ rotate: [0, 3.1415927, 0] }, { scale: [-1, -1, 1] }, { translate: [0, -24.016, 0] }];

function model(id) {
  return { id, layers: { main: { texture: [64, 64], root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} } } } };
}

async function transforms(ids, version, entries) {
  const records = await applyTransforms(ids.map(id => model(id.includes(':') ? id : `minecraft:${id}`)), version, entries);
  return Object.fromEntries(records.map(record => [record.id.replace(/^minecraft:/, ''), record.transform]));
}

test('applies listed ops, living additions, patterns and version limits', async () => {
  const entries = {
    chest: { ops: [], note: 'n' },
    'sign/*': { ops: [{ translate: [8, 8, 8] }], note: 'n' },
    'sign/wall/*': { ops: [{ translate: [0, -5, -7] }], note: 'n' },
    'sign/wall/odd': { ops: [{ scale: [2, 2, 2] }], note: 'n' },
    giant: { living: [{ scale: [6, 6, 6] }], before: '1.21.2', note: 'n' },
    missing: { ops: [], note: 'n' },
    skull: [{ ops: [{ scale: [0.75, 0.75, 0.75] }], before: '1.21.2', note: 'n' }, { ops: [], note: 'n' }],
    bat: [{ living: [{ scale: [0.35, 0.35, 0.35] }], before: '1.20.3', note: 'n' }],
  };
  const ids = ['chest', 'cow', 'giant', 'sign/oak', 'sign/wall/oak', 'sign/wall/odd', 'other:chest'];
  assert.deepEqual(await transforms(ids, '1.20.1', entries), {
    chest: [],
    cow: LIVING,
    giant: [LIVING[0], LIVING[1], { scale: [6, 6, 6] }, LIVING[2]],
    'sign/oak': [{ translate: [8, 8, 8] }],
    'sign/wall/oak': [{ translate: [0, -5, -7] }],
    'sign/wall/odd': [{ scale: [2, 2, 2] }],
    'other:chest': LIVING,
  });
  assert.deepEqual(await transforms(['skull', 'bat'], '1.20.1', entries),
    { skull: [{ scale: [0.75, 0.75, 0.75] }], bat: [LIVING[0], LIVING[1], { scale: [0.35, 0.35, 0.35] }, LIVING[2]] });
  assert.deepEqual(await transforms(['skull', 'bat'], '1.21.2', entries), { skull: [], bat: LIVING });
  assert.deepEqual((await transforms(['giant'], '1.21.2', entries)).giant, LIVING);
  assert.deepEqual((await transforms(['giant'], '1.21.11', entries)).giant, LIVING);
  const [first, second] = await applyTransforms([model('minecraft:cow'), model('minecraft:pig')], '1.21.11', entries);
  assert.notEqual(first.transform[0], second.transform[0]);
  assert.match(stableStringify(validateModel(first)), /^\{"id":"minecraft:cow","layers":\{.*\},"transform":\[\{"rotate":\[0,3\.1415927,0\]\},.*\]\}\n$/);
});

test('the reviewed list covers the non-living renderers', async () => {
  const flip = { scale: [-1, -1, 1] };
  const current = await transforms(['bell', 'chest', 'creeper', 'giant', 'minecart', 'player', 'shulker', 'sign/wall/oak',
    'skeleton_skull', 'tnt_minecart', 'trident', 'wither_skull'], '1.21.11');
  assert.deepEqual(current.bell, []);
  assert.deepEqual(current.chest, []);
  assert.deepEqual(current.creeper, LIVING);
  assert.deepEqual(current.giant, LIVING);
  assert.deepEqual(current.minecart, [{ translate: [0, 6, 0] }, { rotate: [0, 3.1415927, 0] }, flip]);
  assert.deepEqual(current.tnt_minecart, current.minecart);
  assert.deepEqual(current.player, [LIVING[0], flip, { scale: [0.9375, 0.9375, 0.9375] }, LIVING[2]]);
  assert.deepEqual(current.shulker, [flip, LIVING[2]]);
  assert.deepEqual(current['sign/wall/oak'], [{ translate: [8, 8, 8] }, { translate: [0, -5, -7] }, { scale: [0.6666667, -0.6666667, -0.6666667] }]);
  assert.deepEqual(current.skeleton_skull, [{ translate: [8, 0, 8] }, flip]);
  assert.deepEqual(current.trident, [{ rotate: [0, -1.5707964, 0] }, { rotate: [0, 0, 1.5707964] }]);
  assert.deepEqual(current.wither_skull, [flip]);
  const legacy = await transforms(['giant', 'sign/oak', 'trapped_chest'], '1.17.1');
  assert.deepEqual(legacy.giant, [LIVING[0], flip, { scale: [6, 6, 6] }, LIVING[2]]);
  assert.deepEqual(legacy['sign/oak'], [{ translate: [8, 8, 8] }, { scale: [0.6666667, -0.6666667, -0.6666667] }]);
  assert.deepEqual(legacy.trapped_chest, []);

  const entries = JSON.parse(await readFile(new URL('../tools/transforms.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(entries), Object.keys(entries).sort());
  for (const [id, entry] of Object.entries(entries).flatMap(([id, entry]) => [entry].flat().map(entry => [id, entry]))) {
    assert.ok(typeof entry.note === 'string' && entry.note, id);
    assert.equal(Object.hasOwn(entry, 'ops'), !Object.hasOwn(entry, 'living'), id);
    assert.ok(Object.keys(entry).every(key => ['before', 'living', 'note', 'ops'].includes(key)), id);
    validateTransform(entry.ops ?? entry.living);
  }
});

test('schema requires a transform made of rotate, scale and translate ops', () => {
  assert.deepEqual(validateModel({ ...model('minecraft:bell'), transform: [] }).transform, []);
  assert.throws(() => validateModel(model('minecraft:bell')), /Expected object with keys/);
  assert.throws(() => validateModel({ ...model('minecraft:bell'), yUp: true, transform: [] }), /Expected object with keys/);
  for (const transform of [null, {}, [[1, 1, 1]], [{}], [{ rotate: [0, 0] }], [{ shear: [1, 0, 0] }], [{ scale: [1, 1, 1] }],
    [{ translate: [0, 0, 0] }], [{ rotate: [0, 0, 0] }], [{ scale: [2, 2, 2], translate: [1, 0, 0] }], [{ scale: [1, NaN, 1] }]]) {
    assert.throws(() => validateModel({ ...model('minecraft:bell'), transform }), /transform/);
  }
});
