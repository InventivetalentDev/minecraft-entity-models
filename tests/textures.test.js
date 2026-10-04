import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyOverrides, pairTextures, validateTextures } from '../tools/textures.js';

const model = id => ({ id: `minecraft:${id}`, layers: { main: {} } });

test('javap pairing resolves aliases and leaves ambiguous renderer layers unpaired', async () => {
  const fixture = await readFile(new URL('./fixtures/renderers.javap.txt', import.meta.url), 'utf8');
  const records = [model('cow'), model('pig'), model('pig_baby')];
  const fields = {
    COW: { id: 'minecraft:cow', layer: 'main' },
    COW_ALIAS: { id: 'minecraft:cow', layer: 'main' },
    PIG: { id: 'minecraft:pig', layer: 'main' },
    PIG_BABY: { id: 'minecraft:pig_baby', layer: 'main' },
  };
  const { report, sources } = pairTextures(fixture, records, fields);
  assert.equal(records[0].layers.main.textureLocation, 'minecraft:textures/entity/cow/cow.png');
  assert.equal(records[1].layers.main.textureLocation, undefined);
  assert.equal(report.pairings.length, 1);
  assert.deepEqual(report.unpaired.map(entry => entry.className), [
    'net.minecraft.client.renderer.entity.EmptyRenderer', 'net.minecraft.client.renderer.entity.package-info',
    'net.minecraft.client.renderer.entity.PigRenderer',
  ]);
  assert.equal(sources.get('minecraft:cow#main'), 'pass 1');
  const conflict = fixture.replaceAll('CowRenderer', 'OtherCowRenderer').replaceAll('cow/cow.png', 'cow/warm_cow.png');
  const fresh = [model('cow')];
  assert.equal(pairTextures(fixture + conflict, fresh, fields).report.pairings.length, 0);
  assert.equal(fresh[0].layers.main.textureLocation, undefined);
});

test('texture override patterns expand captures before exact overrides and suppression', async () => {
  const records = [model('sign/wall/oak'), model('sign/standing/birch'), model('sign/oak/extra/path'), model('player_head')];
  records[3].layers.main.textureLocation = 'minecraft:textures/entity/player/wide/steve.png';
  const sources = await applyOverrides(records, { overrides: {
    pattern: { 'sign/*/{wood}': 'minecraft:textures/entity/signs/{wood}.png' },
    'sign/standing/birch': { main: 'minecraft:textures/entity/signs/oak.png' },
    player_head: null,
  } });
  assert.equal(records[0].layers.main.textureLocation, 'minecraft:textures/entity/signs/oak.png');
  assert.equal(records[1].layers.main.textureLocation, 'minecraft:textures/entity/signs/oak.png');
  assert.equal(records[2].layers.main.textureLocation, undefined);
  assert.equal(records[3].layers.main.textureLocation, undefined);
  assert.equal(sources.get('minecraft:sign/wall/oak#main'), 'override');
});

test('texture validation rejects missing assets and requires prior HEAD success offline', async t => {
  const cache = await mkdtemp(path.join(tmpdir(), 'model-texture-test-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const records = [model('cow')];
  records[0].layers.main.textureLocation = 'minecraft:textures/entity/cow/cow.png';
  const sources = new Map([['minecraft:cow#main', 'override']]);
  let requests = 0;
  const fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/entity/cow/cow.png');
    assert.equal(options.method, 'HEAD');
    return { ok: false, status: 404 };
  };
  await assert.rejects(validateTextures(records, '1.21.11', sources, { cache, fetch }), /minecraft:cow#main \(override\).*404/);
  await assert.rejects(validateTextures(records, '1.21.11', sources, { cache, offline: true, fetch }), /offline texture cache miss/);
  await validateTextures(records, '1.21.11', sources, { cache, fetch: async () => ({ ok: true, status: 200 }) });
  await validateTextures(records, '1.21.11', sources, { cache, offline: true, fetch });
  assert.equal(requests, 1);
  await assert.rejects(validateTextures(records, '1.21.11', sources, { cache, fetch }), /404/);
  assert.equal(requests, 2);
  let active = 0;
  let maximum = 0;
  const many = Array.from({ length: 17 }, (_, index) => {
    const entry = model(`model_${index}`);
    entry.layers.main.textureLocation = `minecraft:textures/entity/model_${index}.png`;
    return entry;
  });
  await validateTextures(many, '1.21.11', new Map(), { cache, fetch: async () => {
    maximum = Math.max(maximum, ++active);
    await Promise.resolve();
    active--;
    return { ok: true, status: 200 };
  } });
  assert.equal(maximum, 8);
});
