import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stableStringify, validateModel } from '../tools/lib.js';
import { applyPasses, RENDER_MODES, validatePasses } from '../tools/passes.js';

function model(id, layers = { main: 'minecraft:textures/entity/main.png' }) {
  return { id, transform: [], layers: Object.fromEntries(Object.entries(layers).map(([name, textureLocation]) => [name, {
    texture: [64, 64], ...(textureLocation && { textureLocation }), root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} }
  }])) };
}

test('applies layer render modes and passes, skipping missing IDs, layers and newer entries', async t => {
  const cache = await mkdtemp(path.join(tmpdir(), 'entity-models-passes-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const entries = [
    { ids: ['slime', 'missing'], layers: { outer: 'translucent', absent: 'solid' }, passes: [
      { layer: 'outer', textureLocation: 'minecraft:textures/entity/slime.png' },
      { layer: 'main', textureLocation: 'minecraft:textures/entity/eyes.png', render: 'eyes', when: 'powered', tint: 'wool_color' },
      { layer: 'main', textureLocation: 'minecraft:textures/entity/main.png', render: 'cutout' },
      { layer: 'absent' }
    ], evidence: 'test' },
    { ids: ['cow'], since: '1.21', layers: { main: 'solid' }, evidence: 'test' },
    { ids: ['pig'], passes: [{ layer: 'absent' }], evidence: 'test' }
  ];
  const requested = [];
  const fetch = async url => { requested.push(url); return { ok: true, status: 200 }; };
  const records = () => [
    model('minecraft:slime', { main: 'minecraft:textures/entity/main.png', outer: undefined }),
    { ...model('minecraft:cow'), passes: [{ layer: 'main' }] }, model('minecraft:pig'), model('other:slime')
  ];
  const [slime, cow, pig, other] = await applyPasses(records(), '1.20.1', { entries, cache, fetch });
  assert.equal(slime.layers.outer.render, 'translucent');
  assert.deepEqual(slime.passes, [
    { layer: 'outer', textureLocation: 'minecraft:textures/entity/slime.png' },
    { layer: 'main', textureLocation: 'minecraft:textures/entity/eyes.png', render: 'eyes', when: 'powered', tint: 'wool_color' },
    { layer: 'main' }
  ]);
  assert.deepEqual([cow, pig, other], [model('minecraft:cow'), model('minecraft:pig'), model('other:slime')]);
  assert.deepEqual(requested.sort(), ['eyes', 'slime'].map(name => `https://assets.mcasset.cloud/1.20.1/assets/minecraft/textures/entity/${name}.png`));
  assert.match(stableStringify(validateModel(slime)), /"passes":\[\{"layer":"outer","textureLocation":"minecraft:textures\/entity\/slime\.png"\}/);
  assert.equal((await applyPasses(records(), '1.21.11', { entries, cache, fetch }))[1].layers.main.render, 'solid');
  assert.deepEqual((await applyPasses(records(), '1.16.5', { entries, cache, fetch }))[0], records()[0]);
  await assert.rejects(applyPasses(records(), '1.20.1', { entries, cache: path.join(cache, 'other'), fetch: async () => ({ ok: false, status: 404 }) }), /minecraft:slime#passes\[0\].*404/);
  await assert.rejects(applyPasses(records(), '1.20.1', { entries: [{ ids: ['slime'], layers: { main: 'glowing' } }], cache, fetch }), /minecraft:slime: Invalid render mode/);
});

test('validates render modes and passes', () => {
  const valid = { ...model('minecraft:creeper', { main: 'minecraft:textures/entity/main.png', armor: 'minecraft:textures/entity/armor.png' }), passes: [{ layer: 'armor', when: 'powered' }] };
  valid.layers.armor.render = 'energy_swirl';
  assert.equal(validateModel(valid), valid);
  for (const change of [
    value => { value.layers.main.render = 'cutout'; },
    value => { value.layers.main.render = 'unknown'; },
    value => { value.passes = []; },
    value => { value.passes[0].layer = 'missing'; },
    value => { value.passes[0].textureLocation = 'minecraft:textures/entity/armor.png'; },
    value => { value.passes[0].textureLocation = 'minecraft:entity/armor'; },
    value => { value.passes[0].render = 'energy_swirl'; },
    value => { value.passes[0].when = 'Not Sheared'; },
    value => { value.passes[0].extra = true; }
  ]) {
    const invalid = structuredClone(valid);
    change(invalid);
    assert.throws(() => validatePasses(invalid));
    assert.throws(() => validateModel(invalid));
  }
});

test('26.1.2 passes use moved eyes and baby overlay textures from the client', async t => {
  const cache = await mkdtemp(path.join(tmpdir(), 'entity-models-passes-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const records = [model('minecraft:spider'), model('minecraft:wolf_baby')];
  const babyCollar = 'minecraft:textures/entity/wolf/wolf_collar_baby.png';
  await applyPasses(records, '26.1.2', { cache, textureEntries: new Set([babyCollar, 'minecraft:textures/entity/spider/spider_eyes.png']),
    fetch: async () => ({ ok: true, status: 200 }) });
  assert.equal(records[0].passes[0].textureLocation, 'minecraft:textures/entity/spider/spider_eyes.png');
  assert.equal(records[1].passes[0].textureLocation, babyCollar);
  const suffix = [model('minecraft:villager_baby_no_hat')];
  const babyTexture = 'minecraft:textures/entity/villager/villager_baby.png';
  await applyPasses(suffix, '26.1.2', { cache, textureEntries: new Set([babyTexture]),
    entries: [{ ids: ['villager_baby_no_hat'], passes: [{ layer: 'main',
      textureLocation: 'minecraft:textures/entity/villager/villager.png' }] }],
    fetch: async () => ({ ok: true, status: 200 }) });
  assert.equal(suffix[0].passes[0].textureLocation, babyTexture);
});

test('passes.json uses known modes and gives evidence for every entry', async () => {
  const entries = JSON.parse(await readFile(new URL('../tools/passes.json', import.meta.url), 'utf8'));
  const ids = entries.flatMap(entry => entry.ids);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of entries) {
    assert.ok(entry.evidence && (entry.layers || entry.passes), entry.ids.join());
    for (const mode of [...Object.values(entry.layers ?? {}), ...(entry.passes ?? []).flatMap(pass => pass.render ?? [])]) assert.ok(Object.hasOwn(RENDER_MODES, mode), mode);
    for (const pass of entry.passes ?? []) assert.match(pass.textureLocation ?? 'minecraft:textures/x.png', /^minecraft:textures\/[a-z0-9_/]+\.png$/);
  }
  for (const version of ['1.16.5', '1.17.1', '1.20.1', '1.21.11']) {
    const ids = ['piglin', 'piglin_brute', 'zombified_piglin', 'wither_skull', 'trident', 'bat'];
    const records = ids.map(id => model(`minecraft:${id}`));
    await applyPasses(records, version, { entries });
    assert.deepEqual(records.map(record => record.layers.main.render),
      ['translucent', 'translucent', 'translucent', 'translucent', 'solid', version === '1.21.11' ? 'cutout_cull' : undefined]);
  }
});
