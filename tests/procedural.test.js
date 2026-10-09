import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnimations, validateAnimations } from '../tools/animations.js';
import { blockAnimations } from '../tools/procedural-blocks.js';
import { proceduralAnimations } from '../tools/procedural-animations.js';
import { decimateChannel } from '../tools/procedural-decimation.js';

function layer(...names) {
  return { root: { children: Object.fromEntries(names.map(name => [name, { children: {} }])) } };
}

function dump(id, name, bone, extra = {}) {
  return {
    class: 'ExampleModel', modelClasses: ['ExampleModel'], modelIds: [id],
    animations: {
      [name]: { length: 1, loop: true, bones: {
        [bone]: [{ target: 'rotation', keyframes: [{ time: 0, value: [0.2, 0, 0], interpolation: 'linear' }] }],
      } },
    },
    ...extra,
  };
}

function sampleChannel(frames, time) {
  const right = frames.findIndex(frame => frame.time > time);
  if (right === -1) return frames.at(-1).value;
  if (right === 0) return frames[0].value;
  const a = frames[right - 1];
  const b = frames[right];
  const t = (time - a.time) / (b.time - a.time);
  if (b.interpolation === 'linear') {
    return a.value.map((value, axis) => value * (1 - t) + (b.pre ?? b.value)[axis] * t);
  }
  const previous = frames[Math.max(0, right - 2)].value;
  const next = frames[Math.min(frames.length - 1, right + 1)].value;
  return a.value.map((value, axis) => (2 * value + (b.value[axis] - previous[axis]) * t +
    (2 * previous[axis] - 5 * value + 4 * b.value[axis] - next[axis]) * t * t +
    (next[axis] - previous[axis] + 3 * value - 3 * b.value[axis]) * t * t * t) / 2);
}

test('decimation preserves a sine channel within tolerance and keeps its endpoints', () => {
  const pose = time => [Math.sin(time * Math.PI), Math.cos(time * Math.PI) / 2, 0];
  const source = Array.from({ length: 4001 }, (_, index) => ({
    time: index / 1000, value: pose(index / 1000), interpolation: 'linear',
  }));
  const original = structuredClone(source);
  for (const [tolerance, reduced] of [[0.01, decimateChannel(source)], [0.001, decimateChannel(source, 0.001)]]) {
    assert.ok(reduced.length < source.length / 10);
    assert.ok(reduced.some(frame => frame.interpolation === 'catmullrom'));
    assert.deepEqual(source, original);
    for (const index of [0, -1]) {
      assert.equal(reduced.at(index).time, source.at(index).time);
      assert.deepEqual(reduced.at(index).value, source.at(index).value);
    }
    for (let index = 0; index <= 16000; index++) {
      const time = index / 4000;
      const actual = sampleChannel(reduced, time);
      assert.ok(actual.every((value, axis) => Math.abs(value - pose(time)[axis]) <= tolerance),
        `Curve error exceeds ${tolerance} at ${time}`);
    }
  }
});

test('decimation retains pre frames and curve shapes around discontinuities', () => {
  const jump = 0.713;
  const pose = (time, offset = time >= jump ? 5 : 0) => [Math.sin(time * 3) + offset, Math.cos(time * 2), time];
  const source = Array.from({ length: 2001 }, (_, index) => ({
    time: index / 1000, value: pose(index / 1000), interpolation: 'linear',
  }));
  source[713].pre = pose(jump, 0);
  source.at(-1).pre = source.at(-1).value;
  source.at(-1).value = [0, 0, 0];
  const times = [...Array.from({ length: 8000 }, (_, index) => index / 4000),
    jump - 1e-8, jump, jump + 1e-8, 2 - 1e-8];
  for (const [tolerance, reduced] of [[0.01, decimateChannel(source)], [0.001, decimateChannel(source, 0.001)]]) {
    assert.ok(reduced.length < source.length);
    for (const frame of source.filter(frame => frame.pre)) {
      const preserved = reduced.find(candidate => candidate.time === frame.time);
      assert.deepEqual(preserved, frame);
    }
    assert.deepEqual(reduced[0].value, source[0].value);
    assert.equal(reduced[0].time, source[0].time);
    for (const time of times) {
      const actual = sampleChannel(reduced, time);
      assert.ok(actual.every((value, axis) => Math.abs(value - pose(time)[axis]) <= tolerance),
        `Curve error exceeds ${tolerance} at ${time}`);
    }
    assert.deepEqual(sampleChannel(reduced, 2), [0, 0, 0]);
  }
});

test('procedural profiles require the reviewed version and an available model', () => {
  const records = [{ id: 'minecraft:chest' }, { id: 'minecraft:bell' }, { id: 'other:chest' }];
  for (const version of ['1.16.5', '1.21.10', '1.21.12', '26.1.1']) {
    assert.deepEqual(proceduralAnimations(version, records), []);
  }
  assert.deepEqual(proceduralAnimations('1.21.11', []), []);
  assert.deepEqual(proceduralAnimations('1.21.11', records).flatMap(request => request.models).sort(),
    ['minecraft:bell', 'minecraft:chest']);
});

test('chests ease a half-second controller transition and shulker boxes keep linear progress', () => {
  const requests = blockAnimations(['minecraft:chest', 'minecraft:double_chest_left', 'minecraft:shulker_box']);
  const chest = requests.find(request => request.models.includes('minecraft:chest'));
  const shulker = requests.find(request => request.models.includes('minecraft:shulker_box'));
  assert.deepEqual(chest.models, ['minecraft:chest', 'minecraft:double_chest_left']);
  for (const [name, start, end] of [['open', 0, 1], ['close', 1, 0]]) {
    for (const request of [chest, shulker]) {
      const clip = request.clips[name];
      assert.equal(clip.length, 0.5);
      assert.equal(clip.loop, false);
      assert.equal(clip.frames[0].time, 0);
      assert.equal(clip.frames.at(-1).time, 0.5);
      assert.equal(clip.frames[0].values[0], start);
      assert.equal(clip.frames.at(-1).values[0], end);
    }
    assert.ok(Math.abs(chest.clips[name].frames.find(frame => frame.time === 0.25).values[0] - 0.875) < 1e-6);
    assert.ok(Math.abs(shulker.clips[name].frames.find(frame => frame.time === 0.25).values[0] - 0.5) < 1e-6);
  }
});

test('bell clips preserve the reset boundary and banners target the flag layer', () => {
  const requests = blockAnimations(['minecraft:bell', 'minecraft:standing_banner', 'minecraft:wall_banner']);
  const bell = requests.find(request => request.models.includes('minecraft:bell'));
  assert.deepEqual(Object.keys(bell.clips).sort(), ['ring_east', 'ring_north', 'ring_south', 'ring_west']);
  for (const [name, clip] of Object.entries(bell.clips)) {
    assert.equal(clip.loop, false);
    assert.deepEqual(clip.frames.at(-1), {
      time: 2.5,
      pre: [{ ticks: 50, shakeDirection: name.slice(5).toUpperCase() }],
      values: [{ ticks: 0, shakeDirection: null }],
    });
  }
  const banner = requests.find(request => request.models.includes('minecraft:standing_banner'));
  assert.equal(banner.layer, 'flag');
  assert.equal(banner.clips.sway.length, 5);
  assert.equal(banner.clips.sway.loop, true);
});

test('animation layers map bones independently and reject redundant or malformed layer names', () => {
  const record = { id: 'minecraft:standing_banner', layers: { main: layer('pole'), flag: layer('flag') } };
  const entry = dump(record.id, 'sway', 'flag', { layer: 'flag' });
  const { animations, findings } = buildAnimations([entry], [record]);
  assert.deepEqual(findings, []);
  assert.equal(animations[0].animations.sway.layer, 'flag');
  validateAnimations(animations[0]);
  const missing = dump(record.id, 'sway', 'pole', { layer: 'flag' });
  assert.deepEqual(buildAnimations([missing], [record]).findings,
    ['minecraft:standing_banner sway: bones not in the flag layer: pole']);
  assert.throws(() => buildAnimations([{ ...entry, layer: 'absent' }], [record]), /animation layer not found: absent/);
  for (const name of ['', 'main', 'Flag', 1]) {
    const invalid = structuredClone(animations[0]);
    invalid.animations.sway.layer = name;
    assert.throws(() => validateAnimations(invalid), /Animation layer/);
  }
});

test('sampled clips join existing definitions without changing them or overwriting a name', () => {
  const record = { id: 'minecraft:example', layers: { main: layer('body') } };
  const native = dump(record.id, 'EXAMPLE_JUMP', 'body', { class: 'ExampleAnimation' });
  const sampled = dump(record.id, 'walk', 'body', { layer: 'main' });
  const original = buildAnimations([native], [record]).animations[0].animations.jump;
  const { animations, findings } = buildAnimations([native, sampled], [record]);
  assert.deepEqual(findings, []);
  assert.deepEqual(animations[0].animations.jump, original);
  assert.deepEqual(Object.keys(animations[0].animations), ['jump', 'walk']);
  assert.equal(Object.hasOwn(animations[0].animations.walk, 'layer'), false);
  validateAnimations(animations[0]);
  assert.throws(() => buildAnimations([native, dump(record.id, 'jump', 'body')], [record]), /Duplicate animation jump/);
});

test('mixed-frequency clips preserve their loop boundaries and overlays require an available layer', () => {
  const records = [
    { id: 'minecraft:horse', layers: { main: layer() } },
    { id: 'minecraft:horse_baby', layers: { main: layer() } },
    { id: 'minecraft:donkey_baby', layers: { main: layer() } },
    { id: 'minecraft:undead_horse_baby_armor', layers: { main: layer() } },
    { id: 'minecraft:piglin', layers: { main: layer() } },
    { id: 'minecraft:cow', layers: { main: layer() } },
    { id: 'minecraft:axolotl', layers: { main: layer() } },
    { id: 'minecraft:sheep', layers: { main: layer(), wool: layer() } },
    { id: 'minecraft:skeleton', layers: { main: layer(), helmet: layer() } },
  ];
  const requests = proceduralAnimations('1.21.11', records);
  for (const id of ['minecraft:horse', 'minecraft:piglin']) {
    const request = requests.find(entry => entry.models.includes(id) && !entry.layer);
    assert.equal(request.clips.walk_sample.loop, false);
    assert.equal(Object.hasOwn(request.clips, 'walk_cycle'), false);
  }
  for (const [id, ageScale] of [['horse', 1], ['horse_baby', 0.5], ['donkey_baby', 0.5], ['undead_horse_baby_armor', 0.5]]) {
    const request = requests.find(entry => entry.models.includes(`minecraft:${id}`));
    for (const frame of request.clips.walk_sample.frames) {
      assert.equal(frame.values[0].ageScale, ageScale);
      assert.equal(frame.values[0].isBaby, ageScale === 0.5);
    }
  }
  assert.equal(requests.find(entry => entry.models.includes('minecraft:cow')).clips.walk_cycle.loop, true);
  const swim = requests.find(entry => entry.models.includes('minecraft:axolotl')).clips.swim;
  const phase = swim.frames.at(-1).values[0].ageInTicks * Math.fround(0.33);
  assert.ok(Math.abs(Math.cos(phase) - 1) < 1e-6);
  assert.ok(Math.abs(Math.cos(phase * Math.fround(0.9)) - 1) < 1e-6);
  const overlays = requests.filter(request => request.layer);
  assert.deepEqual(overlays.map(request => request.layer).sort(), ['helmet', 'wool', 'wool']);
  assert.ok(overlays.some(request => request.models.includes('minecraft:skeleton') && request.clips.walk_cycle_helmet));
  assert.ok(overlays.some(request => request.models.includes('minecraft:sheep') && request.clips.walk_cycle_wool));
  assert.ok(overlays.some(request => request.models.includes('minecraft:sheep') && request.clips.eat_wool));
});
