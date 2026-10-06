import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyEquipmentTextures, applyOverrides, applyStemTextures, inheritBabyTextures, pairTextures, validateTextures } from '../tools/textures.js';

const model = id => ({ id: `minecraft:${id}`, layers: { main: {} } });

test('javap pairing ignores armor sets, resolves aliases, and shares one texture across layers', async () => {
  const fixture = await readFile(new URL('./fixtures/renderers.javap.txt', import.meta.url), 'utf8');
  const records = [model('cow'), model('pig'), model('pig_baby')];
  records.push({ id: 'minecraft:creeper', layers: { main: {}, armor: {} } });
  const fields = {
    COW: { id: 'minecraft:cow', layer: 'main' },
    COW_ALIAS: { id: 'minecraft:cow', layer: 'main' },
    PIG: { id: 'minecraft:pig', layer: 'main' },
    PIG_BABY: { id: 'minecraft:pig_baby', layer: 'main' },
    CREEPER: { id: 'minecraft:creeper', layer: 'main' },
    CREEPER_ARMOR: { id: 'minecraft:creeper', layer: 'armor' },
  };
  const { report, sources } = pairTextures(fixture, records, fields);
  assert.equal(records[0].layers.main.textureLocation, 'minecraft:textures/entity/cow/cow.png');
  assert.equal(records[1].layers.main.textureLocation, 'minecraft:textures/entity/pig/pig.png');
  assert.equal(records[2].layers.main.textureLocation, 'minecraft:textures/entity/pig/pig.png');
  assert.equal(records[3].layers.main.textureLocation, undefined);
  assert.equal(report.pairings.length, 3);
  assert.deepEqual(report.unpaired.map(entry => entry.className), [
    'net.minecraft.client.renderer.entity.CreeperRenderer',
    'net.minecraft.client.renderer.entity.EmptyRenderer', 'net.minecraft.client.renderer.entity.package-info',
  ]);
  assert.equal(sources.get('minecraft:cow#main'), 'pass 1');
  const conflict = fixture.replaceAll('CowRenderer', 'OtherCowRenderer').replaceAll('cow/cow.png', 'cow/warm_cow.png');
  const fresh = [model('cow')];
  assert.equal(pairTextures(fixture + conflict, fresh, fields).report.pairings.length, 0);
  assert.equal(fresh[0].layers.main.textureLocation, undefined);
});

test('stem matches distinguish layer names and leave duplicate basenames unresolved', () => {
  const records = [model('creeper'), model('creeper_baby'), model('unknown'), model('pig')];
  records[0].layers.armor = {};
  records[1].layers.armor = {};
  const sources = new Map();
  const missing = applyStemTextures([
    'textures/entity/creeper/creeper.png', 'textures/entity/creeper/creeper_armor.png',
    'textures/entity/pig/pig.png', 'textures/entity/other/pig.png',
  ], records, sources);
  assert.equal(records[0].layers.armor.textureLocation, 'minecraft:textures/entity/creeper/creeper_armor.png');
  assert.equal(records[1].layers.main.textureLocation, records[0].layers.main.textureLocation);
  assert.equal(records[1].layers.armor.textureLocation, records[0].layers.armor.textureLocation);
  assert.match(missing.get('minecraft:unknown#main').reason, /No exact texture stem/);
  assert.equal(missing.get('minecraft:pig#main').candidates.length, 2);
  assert.equal(records[3].layers.main.textureLocation, undefined);
  assert.equal(sources.get('minecraft:creeper#armor'), 'stem');
});

test('equipment assets with one texture fill the unset main layer of the same model ID', () => {
  const records = [model('elytra'), model('elytra_baby'), model('saddle'), model('trader_llama')];
  records[3].layers.main.textureLocation = 'minecraft:textures/entity/llama/creamy.png';
  const sources = new Map();
  applyEquipmentTextures({
    'minecraft:elytra': { layers: { wings: [{ texture: 'minecraft:elytra', use_player_texture: true }] } },
    'minecraft:saddle': { layers: { horse_saddle: [{ texture: 'minecraft:saddle' }], pig_saddle: [{ texture: 'minecraft:saddle' }] } },
    'minecraft:trader_llama': { layers: { llama_body: [{ texture: 'minecraft:trader_llama' }] } },
  }, records, sources);
  inheritBabyTextures(records, sources);
  assert.equal(records[0].layers.main.textureLocation, 'minecraft:textures/entity/equipment/wings/elytra.png');
  assert.equal(records[1].layers.main.textureLocation, records[0].layers.main.textureLocation);
  assert.equal(records[2].layers.main.textureLocation, undefined);
  assert.equal(records[3].layers.main.textureLocation, 'minecraft:textures/entity/llama/creamy.png');
  assert.equal(sources.get('minecraft:elytra#main'), 'equipment');
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

test('baby textures follow final parent overrides while preserving explicit exclusions', async () => {
  const records = ['cow', 'cow_baby', 'pig', 'pig_baby', 'cat', 'cat_baby', 'zombie', 'zombie_baby', 'orphan_baby'].map(model);
  for (const entry of records) entry.layers.main.textureLocation = 'minecraft:textures/entity/initial.png';
  const sources = await applyOverrides(records, { overrides: {
    cow: 'minecraft:textures/entity/cow/temperate_cow.png',
    pig: 'minecraft:textures/entity/pig/temperate_pig.png',
    pig_baby: null,
    cat: 'minecraft:textures/entity/cat/black.png',
    cat_baby: 'minecraft:textures/entity/cat/tabby.png',
    zombie: null,
  } });
  inheritBabyTextures(records, sources);
  assert.equal(records[1].layers.main.textureLocation, records[0].layers.main.textureLocation);
  assert.equal(records[3].layers.main.textureLocation, undefined);
  assert.equal(records[5].layers.main.textureLocation, 'minecraft:textures/entity/cat/tabby.png');
  assert.equal(records[7].layers.main.textureLocation, undefined);
  assert.equal(records[8].layers.main.textureLocation, 'minecraft:textures/entity/initial.png');
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
