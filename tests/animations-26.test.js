import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeAnimations26, normalizeAnimationRoots26, proceduralAnimations26 } from '../tools/animations-26.js';
import { extractionAdapter } from '../tools/extraction-adapters.js';
import { entityAnimations } from '../tools/procedural-entities.js';

test('extraction adapters select only reviewed hooks and sampler dependencies', () => {
  const current = extractionAdapter('26.1.2');
  assert.equal(current.normalizeModels, normalizeAnimationRoots26);
  assert.equal(current.nativeAnimations, nativeAnimations26);
  for (const version of ['1.21.11', '26.1.3', '26.2']) {
    const adapter = extractionAdapter(version);
    const records = [];
    assert.equal(adapter.normalizeModels(records), records);
    assert.equal(adapter.nativeAnimations(records), records);
    assert.deepEqual(adapter.samplerLibraries, []);
  }
  for (const version of ['1.17.1', '1.20.1']) {
    const libraries = extractionAdapter(version).samplerLibraries;
    assert.equal(libraries.length, 1);
    assert.equal(libraries[0].downloads.artifact.sha1, '25ea2e8b0c338a877313bd4672d3fe056ea78f0d');
  }
});

test('26.1.2 baby axolotl root targets the named child without changing geometry or poses', () => {
  const animatedRoot = { pose: { offset: [0, 24, 0], rotation: [0, 0, 0] }, cubes: [], children: { body: {} } };
  const wrapper = { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: { root: animatedRoot } };
  const records = [{ id: 'minecraft:axolotl_baby', layers: { main: { root: structuredClone(wrapper) } } },
    { id: 'minecraft:axolotl', layers: { main: { root: structuredClone(wrapper) } } }];
  normalizeAnimationRoots26(records);
  assert.deepEqual(records[0].layers.main.root, { ...wrapper, children: { animation_root: animatedRoot } });
  assert.deepEqual(records[1].layers.main.root, wrapper);
  const animation = { length: 1, loop: false, bones: { root: [{ target: 'rotation', keyframes: [] }], body: [] } };
  const dump = [{ class: 'BabyAxolotlAnimation', animations: { PLAY_DEAD: animation } }];
  const before = structuredClone(dump);
  const result = nativeAnimations26(dump)[0].animations.PLAY_DEAD;
  assert.deepEqual(result, { ...animation, bones: { animation_root: animation.bones.root, body: [] } });
  assert.deepEqual(dump, before);
  records[0].layers.main.root = { ...wrapper, children: {} };
  assert.throws(() => normalizeAnimationRoots26(records), /Unexpected.*animation root/);
});

test('26.1.2 native definitions distinguish compatible adult and baby layers', () => {
  const dump = ['CamelAnimation', 'CamelBabyAnimation'].map(name => ({
    class: name, modelIds: ['minecraft:camel', 'minecraft:camel_baby'], animations: { dash: {} },
  }));
  const before = structuredClone(dump);
  const result = nativeAnimations26(dump);
  assert.deepEqual(result.map(entry => entry.modelIds), [['minecraft:camel'], ['minecraft:camel_baby']]);
  assert.deepEqual(dump, before);
});

test('26.1.2 profiles use renamed adults and dedicated babies without changing shared inputs', () => {
  const models = 'net.minecraft.client.model.';
  const requests = [
    { class: models + 'animal.feline.CatModel', models: ['minecraft:cat', 'minecraft:cat_baby'], clips: { walk_sample: {} } },
    { class: models + 'animal.axolotl.AxolotlModel', models: ['minecraft:axolotl', 'minecraft:axolotl_baby'], clips: { swim: {} } },
    { class: models + 'animal.rabbit.RabbitModel', models: ['minecraft:rabbit'], clips: { jump: {} } },
    { class: 'net.minecraft.client.renderer.blockentity.ShulkerBoxRenderer$ShulkerBoxModel', models: ['minecraft:shulker_box'] },
    { class: models + 'npc.VillagerModel', models: ['minecraft:villager_baby_no_hat', 'minecraft:villager_babylon'], clips: {} },
  ];
  const before = structuredClone(requests);
  const result = proceduralAnimations26(requests);
  assert.deepEqual(result.map(request => [request.class, request.models]), [
    [models + 'animal.feline.AdultCatModel', ['minecraft:cat']],
    [models + 'animal.feline.BabyCatModel', ['minecraft:cat_baby']],
    [models + 'animal.axolotl.AdultAxolotlModel', ['minecraft:axolotl']],
    [requests[3].class, ['minecraft:shulker_box']],
    [models + 'npc.BabyVillagerModel', ['minecraft:villager_baby_no_hat']],
    [models + 'npc.VillagerModel', ['minecraft:villager_babylon']],
  ]);
  assert.deepEqual(requests, before);
});

test('26.1.2 book frames invoke the vanilla openness factory, including discontinuities', () => {
  const state = { animationPos: 10, pageFlip1: 0.1, pageFlip2: 0.9, open: 0.5 };
  const request = { class: 'net.minecraft.client.model.object.book.BookModel', models: ['minecraft:book'], clips: {
    open: { frames: [{ time: 0.5, values: [state], pre: [{ ...state, open: 0.4 }] }] },
  } };
  const frame = proceduralAnimations26([request])[0].clips.open.frames[0];
  assert.deepEqual(frame.values[0].$factory, {
    method: 'forAnimation', parameters: ['float', 'float', 'float', 'float'], values: [10, 0.1, 0.9, 0.5],
  });
  assert.equal(frame.pre[0].$factory.values[3], 0.4);
  assert.equal(request.clips.open.frames[0].values[0], state);
});

test('26.1.2 cold variants use baby controllers and retain the shared profile inputs', () => {
  const requests = entityAnimations(['minecraft:cold_pig', 'minecraft:cold_pig_baby',
    'minecraft:cold_chicken', 'minecraft:cold_chicken_baby', 'minecraft:cat', 'minecraft:cat_baby']);
  const before = structuredClone(requests);
  const result = proceduralAnimations26(requests);
  for (const [id, controller] of [['cold_pig', 'animal.pig.ColdPigModel'], ['cold_pig_baby', 'animal.pig.BabyPigModel'],
    ['cold_chicken', 'animal.chicken.ColdChickenModel'], ['cold_chicken_baby', 'animal.chicken.BabyChickenModel'],
    ['cat', 'animal.feline.AdultCatModel'], ['cat_baby', 'animal.feline.BabyCatModel']]) {
    const model = `minecraft:${id}`;
    const original = requests.find(request => request.models.includes(model));
    const adapted = result.find(request => request.models.includes(model));
    assert.equal(adapted.class, `net.minecraft.client.model.${controller}`);
    assert.equal(adapted.parameters, original.parameters);
    assert.equal(adapted.clips, original.clips);
  }
  assert.deepEqual(requests, before);
});
