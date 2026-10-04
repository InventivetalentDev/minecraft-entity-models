import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stableStringify, validateModel, writeDataset } from '../tools/lib.js';

function model(id = 'minecraft:cow') {
  return {
    id,
    layers: {
      main: {
        texture: [64, 32],
        root: {
          pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
          cubes: [],
          children: {
            head: {
              pose: { offset: [0, 4, -8], rotation: [0.5, 0, 0], scale: [0.5, 0.5, 0.5] },
              cubes: [{ origin: [-4, -4, -4], size: [8, 8, 8], uv: [0, 0], grow: [0.1, 0.1, 0.1], mirror: true }],
              children: {},
            },
          },
        },
      },
    },
  };
}

async function directory(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'entity-models-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return path.join(temporary, 'output');
}

test('generated model preserves geometry and validates against the schema', async t => {
  const output = await directory(t);
  const expected = model();
  assert.equal(await writeDataset(output, { id: '1.21.11' }, [expected]), 1);
  const text = await readFile(path.join(output, 'minecraft/cow.json'), 'utf8');
  const generated = JSON.parse(text);
  assert.deepEqual(validateModel(generated), expected);
  assert.equal(text, stableStringify(expected));
  assert.equal(stableStringify({ 2: 'b', 10: 'a' }), '{"10":"a","2":"b"}\n');
  await assert.rejects(writeDataset(output, { id: '1.21.11' }, []), /already exists/);
});

test('schema rejects malformed geometry and redundant optional fields', () => {
  for (const mutate of [
    value => { value.layers.main.root.pose.rotation = [0, 0]; },
    value => { value.layers.main.root.pose.scale = [1, 1, 1]; },
    value => { value.layers.main.root.texture = [64, 32]; },
    value => { value.layers.main.root.children.head.cubes[0].mirror = false; },
    value => { value.layers.main.root.children.head.cubes[0].grow = [0, 0, 0]; },
    value => { value.layers.main.root.children.head.cubes[0].size[0] = NaN; },
    value => { value.id = 'minecraft:../cow'; },
  ]) {
    const invalid = model();
    mutate(invalid);
    assert.throws(() => validateModel(invalid));
  }
});

test('directory listings include sorted files and nested directories without themselves', async t => {
  const output = await directory(t);
  await writeDataset(output, { id: '1.21.11' }, [
    model('minecraft:zombie'),
    model('minecraft:cow'),
    model('minecraft:boat/oak'),
  ]);
  const listing = async relative => JSON.parse(await readFile(path.join(output, relative, '_list.json'), 'utf8'));
  assert.deepEqual(await listing(''), { directories: ['minecraft'], files: ['version.json'] });
  assert.deepEqual(await listing('minecraft'), { directories: ['boat'], files: ['cow.json', 'zombie.json'] });
  assert.deepEqual(await listing('minecraft/boat'), { directories: [], files: ['oak.json'] });
});

test('a child below a texture override may restate the layer size', () => {
  const value = model();
  value.layers.main.root.texture = [32, 32];
  const child = value.layers.main.root.children.head;
  child.texture = [64, 32];
  assert.equal(validateModel(value), value);
  child.texture = [32, 32];
  assert.throws(() => validateModel(value), /matching the inherited size/);
});
