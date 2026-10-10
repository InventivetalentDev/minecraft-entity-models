import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addTextures, applyEquipmentTextures, applyOverrides, applyStemTextures, applyVariantTextures, inheritBabyTextures, pairTextures, validateTextures } from '../tools/textures.js';
import { versionTexture } from '../tools/texture-paths.js';

const model = id => ({ id: `minecraft:${id}`, layers: { main: {} } });

test('variant fields select separate baby assets and cold and warm geometry', () => {
  const records = ['cow', 'cow_baby', 'cold_cow', 'cold_cow_baby', 'warm_cow'].map(model);
  const variants = ['temperate', 'cold', 'warm'].map(variant => ({ name: 'cow', variant, data: {
    asset_id: `minecraft:entity/cow/cow_${variant}`, baby_asset_id: `minecraft:entity/cow/cow_${variant}_baby`,
    ...(variant === 'temperate' ? {} : { model: variant }),
  } }));
  const sources = new Map();
  applyVariantTextures(variants, records, sources);
  inheritBabyTextures(records, sources);
  assert.deepEqual(records.map(record => record.layers.main.textureLocation),
    ['temperate', 'temperate_baby', 'cold', 'cold_baby', 'warm'].map(name => `minecraft:textures/entity/cow/cow_${name}.png`));
  const older = ['cow', 'cow_baby', 'cold_cow'].map(model);
  applyVariantTextures(variants.map(({ data, ...variant }) => {
    const { baby_asset_id, ...adultData } = data;
    return { ...variant, data: adultData };
  }), older);
  assert.equal(older[1].layers.main.textureLocation, older[0].layers.main.textureLocation);
  assert.equal(older[2].layers.main.textureLocation, 'minecraft:textures/entity/cow/cow_cold.png');
});

test('texture paths use moved and baby assets only when the jar contains them', () => {
  const cat = 'minecraft:textures/entity/cat/black.png';
  const adult = 'minecraft:textures/entity/cat/cat_black.png';
  const baby = 'minecraft:textures/entity/cat/cat_black_baby.png';
  const entries = new Set([adult, baby, 'minecraft:textures/entity/sniffer/snifflet.png']);
  assert.equal(versionTexture(cat, true, entries), baby);
  assert.equal(versionTexture(cat, false, entries), adult);
  assert.equal(versionTexture(cat, true), cat);
  assert.equal(versionTexture(cat, true, new Set([cat, ...entries])), cat);
  assert.equal(versionTexture('minecraft:textures/entity/sniffer/sniffer.png', true, entries),
    'minecraft:textures/entity/sniffer/snifflet.png');
  const eyes = 'minecraft:textures/entity/spider/spider_eyes.png';
  assert.equal(versionTexture('minecraft:textures/entity/spider_eyes.png', false, new Set([eyes])), eyes);
});

test('explicit overrides take the moved and baby assets of a later release', async () => {
  const records = ['cat', 'cat_baby'].map(model);
  // Without a jar no texture entries are known, so the overrides stay as written.
  await addTextures(records, { validate: false });
  assert.equal(records[1].layers.main.textureLocation, 'minecraft:textures/entity/cat/black.png');
  const entries = new Set(['minecraft:textures/entity/cat/cat_black.png', 'minecraft:textures/entity/cat/cat_black_baby.png']);
  assert.equal(versionTexture(records[0].layers.main.textureLocation, false, entries), 'minecraft:textures/entity/cat/cat_black.png');
  assert.equal(versionTexture(records[1].layers.main.textureLocation, true, entries), 'minecraft:textures/entity/cat/cat_black_baby.png');
});

test('baby models retain suffixes when matching stems and inheriting textures', async () => {
  const records = ['happy_ghast_ropes', 'happy_ghast_baby_ropes', 'villager_no_hat', 'villager_baby_no_hat',
    'wolf_armor', 'wolf_baby_armor', 'wolf_babylon'].map(model);
  const sources = new Map();
  applyStemTextures(['textures/entity/ghast/happy_ghast_ropes.png'], records, sources);
  assert.equal(records[1].layers.main.textureLocation, records[0].layers.main.textureLocation);
  await applyOverrides(records, { sources, overrides: {
    villager_no_hat: 'minecraft:textures/entity/villager/villager.png', wolf_armor: null,
  } });
  records[5].layers.main.textureLocation = 'minecraft:textures/entity/unwanted.png';
  inheritBabyTextures(records, sources);
  assert.equal(records[3].layers.main.textureLocation, records[2].layers.main.textureLocation);
  assert.equal(records[5].layers.main.textureLocation, undefined);
  assert.equal(sources.get('minecraft:wolf_baby_armor#main'), 'inherited null override');
  assert.equal(records[6].layers.main.textureLocation, undefined);
});

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
  const options = { version: '1.21.11', cache, offline: true };
  await assert.rejects(addTextures([model('arrow')], options), /offline texture cache miss/);
  const deferred = [model('arrow')];
  assert.equal((await addTextures(deferred, { ...options, validate: false })).withTexture, 1);
  assert.equal(deferred[0].layers.main.textureLocation, 'minecraft:textures/entity/projectiles/arrow.png');
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
