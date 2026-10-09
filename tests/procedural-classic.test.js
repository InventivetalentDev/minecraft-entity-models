import assert from 'node:assert/strict';
import test from 'node:test';
import { classicAnimations } from '../tools/procedural-classic.js';

const records = (...ids) => ids.map(id => ({ id: `minecraft:${id}`, layers: { main: {} } }));

test('classic block aliases sample their original layers with the alias baked poses', () => {
  const input = records('banner', 'standing_banner', 'wall_banner', 'shulker', 'shulker_box');
  for (const version of ['1.17.1', '1.20.1']) {
    const requests = classicAnimations(version, input);
    const banner = requests.find(request => request.models.includes('minecraft:standing_banner'));
    assert.deepEqual(banner.models, ['minecraft:standing_banner', 'minecraft:wall_banner']);
    assert.equal(banner.layer, 'flag');
    assert.deepEqual(banner.modelLayer, { model: 'minecraft:banner', layer: 'main', poses: { flag: { y: -32 } } });
    assert.ok(banner.clips.sway.frames.every(frame => frame.values[0].flag.y === -32));
    const box = requests.find(request => request.models.includes('minecraft:shulker_box'));
    assert.deepEqual(box.modelLayer, { model: 'minecraft:shulker', layer: 'main' });
    assert.deepEqual(Object.keys(box.clips), ['open', 'close']);
    assert.equal(box.clips.open.frames[0].values[0].lid.y, 24);
    assert.equal(box.clips.open.frames.at(-1).values[0].lid.y, 16);
  }
  assert.deepEqual(classicAnimations('1.21.11', input), []);
});

test('classic tick counters preserve branch changes and final reset poses', () => {
  const requests = classicAnimations('1.20.1', records('ravager', 'iron_golem'));
  const ravager = requests.find(request => request.clips.attack && request.models.includes('minecraft:ravager'));
  const attack = ravager.clips.attack;
  const branch = attack.frames.find(frame => frame.time === 0.25);
  assert.equal(branch.pre[0].getters.getAttackTick, 6);
  assert.equal(branch.pre[3], 1);
  assert.equal(branch.values[0].getters.getAttackTick, 5);
  assert.equal(branch.values[3], 0);
  assert.equal(attack.frames.at(-1).pre[0].getters.getAttackTick, 1);
  assert.equal(attack.frames.at(-1).pre[3], 1);
  assert.equal(attack.frames.at(-1).values[0].getters.getAttackTick, 0);
  const golem = requests.find(request => request.clips.attack && request.models.includes('minecraft:iron_golem'));
  assert.equal(golem.method, 'prepareMobModel');
  assert.equal(golem.clips.attack.loop, false);
});

test('stateful axolotl sequences and integer parrot phases do not claim seamless loops', () => {
  for (const version of ['1.17.1', '1.20.1']) {
    const requests = classicAnimations(version, records('axolotl', 'parrot'));
    const axolotl = requests.find(request => request.models.includes('minecraft:axolotl'));
    assert.equal(axolotl.continuous, true);
    assert.deepEqual(Object.keys(axolotl.clips), ['swim_sample', 'hover_sample', 'crawl_sample', 'idle_sample']);
    for (const clip of Object.values(axolotl.clips)) {
      assert.equal(clip.loop, false);
      assert.equal(clip.length, 5);
      assert.equal(clip.frames.length, 601);
      assert.deepEqual(clip.frames[0].values[0].getters.getModelRotationValues, { $new: 'java.util.HashMap' });
    }
    const parrot = requests.find(request => request.models.includes('minecraft:parrot'));
    assert.equal(parrot.clips.dance_sample.loop, false);
    const tick = parrot.clips.dance_sample.frames.find(frame => frame.time === 0.05);
    assert.equal(tick.pre[1], 0);
    assert.equal(tick.values[1], 1);
    assert.equal(parrot.clips.fly.loop, true);
  }
});

test('classic overlays receive the matching controller only when their layer exists', () => {
  const overlays = [['creeper', 'armor', 'CreeperModel', 'walk_cycle'], ['cat', 'collar', 'CatModel', 'walk_sample'],
    ['drowned', 'outer', 'DrownedModel', 'walk_cycle'], ['stray', 'outer', 'SkeletonModel', 'walk_cycle'],
    ['tropical_fish_small', 'pattern', 'TropicalFishModelA', 'swim'], ['tropical_fish_large', 'pattern', 'TropicalFishModelB', 'swim']];
  const input = [...overlays.map(([id, layer]) => ({ id: `minecraft:${id}`, layers: { main: {}, [layer]: {} } })), ...records('skeleton')];
  for (const version of ['1.17.1', '1.20.1']) {
    const requests = classicAnimations(version, input);
    for (const [id, layer, model, name] of overlays) {
      const main = requests.find(request => !request.layer && request.models.includes(`minecraft:${id}`));
      const overlay = requests.find(request => request.layer === layer && request.models.includes(`minecraft:${id}`));
      assert.equal(overlay.class, `net.minecraft.client.model.${model}`);
      assert.deepEqual(Object.keys(overlay.clips), [`${name}_${layer}`]);
      assert.deepEqual(overlay.clips[`${name}_${layer}`], main.clips[name]);
    }
    assert.ok(requests.filter(request => request.layer === 'outer').every(request => !request.models.includes('minecraft:skeleton')));
  }
});
