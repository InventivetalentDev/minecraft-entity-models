import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { animationNames, buildAnimations, validateAnimationFile, validateAnimations } from '../tools/animations.js';
import { writeDataset } from '../tools/lib.js';

function model(id, children) {
  const part = names => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
    cubes: [],
    children: Object.fromEntries(Object.entries(names).map(([name, nested]) => [name, part(nested)])),
  });
  return { id, transform: [], layers: { main: { texture: [64, 64], root: part(children) } } };
}

function keyframe(time, value = [0, 0, 0], interpolation = 'linear') {
  return { time, value, interpolation };
}

function dump(overrides = {}) {
  return [{
    class: 'FrogAnimation',
    modelClasses: ['net.minecraft.client.model.FrogModel'],
    modelIds: ['minecraft:frog', 'minecraft:frog_baby'],
    animations: {
      FROG_JUMP: {
        length: 0.5,
        loop: false,
        bones: {
          body: [
            { target: 'rotation', keyframes: [keyframe(0), keyframe(0.5, [-0.3926991, 0, 0], 'catmullrom')] },
            { target: 'position', keyframes: [keyframe(0, [0, -1, 0])] },
          ],
          root: [{ target: 'scale', keyframes: [keyframe(0, [-1, -1, -1])] }],
          tongue: [{ target: 'rotation', keyframes: [keyframe(0)] }],
        },
      },
      FROG_IDLE_WATER: { length: 3, loop: true, bones: { body: [{ target: 'rotation', keyframes: [keyframe(0)] }] } },
    },
    ...overrides,
  }];
}

test('animation names drop a mob prefix shared by every field of the class', () => {
  assert.deepEqual([...animationNames('WardenAnimation', ['WARDEN_EMERGE', 'WARDEN_SONIC_BOOM']).values()], ['emerge', 'sonic_boom']);
  assert.deepEqual([...animationNames('CopperGolemAnimation', ['COPPER_GOLEM_WALK', 'COPPER_GOLEM_WALK_ITEM']).values()], ['walk', 'walk_item']);
  assert.deepEqual([...animationNames('SnifferAnimation', ['BABY_TRANSFORM', 'SNIFFER_DIG']).values()], ['baby_transform', 'sniffer_dig']);
  assert.deepEqual([...animationNames('BreezeAnimation', ['IDLE', 'SLIDE_BACK']).values()], ['idle', 'slide_back']);
  assert.deepEqual([...animationNames('CamelAnimation', ['CAMEL_', 'CAMEL_SIT']).values()], ['camel_', 'camel_sit']);
  assert.throws(() => animationNames('BatAnimation', ['BAT_FLY', 'Bat_Fly']), /Duplicate animation names/);
});

test('animations map to every model id of their class and report unknown bones', () => {
  const records = [model('minecraft:frog', { body: { tongue: {} } }), model('minecraft:frog_baby', { body: {} })];
  const { animations, findings } = buildAnimations(dump(), records);
  assert.deepEqual(animations.map(file => file.id), ['minecraft:frog', 'minecraft:frog_baby']);
  assert.deepEqual(Object.keys(animations[0].animations), ['jump', 'idle_water']);
  assert.deepEqual(animations[0].animations.jump, {
    length: 0.5,
    loop: false,
    bones: {
      body: {
        rotation: [keyframe(0), keyframe(0.5, [-0.3926991, 0, 0], 'catmullrom')],
        position: [keyframe(0, [0, -1, 0])],
      },
      root: { scale: [keyframe(0, [-1, -1, -1])] },
      tongue: { rotation: [keyframe(0)] },
    },
  });
  assert.deepEqual(findings, ['minecraft:frog_baby jump: bones not in the main layer: tongue']);
  for (const file of animations) validateAnimations(file);
});

test('animation classes without a model and repeated channels are not written silently', () => {
  assert.deepEqual(buildAnimations(dump({ modelClasses: [], modelIds: [] }), []),
    { animations: [], findings: ['FrogAnimation: no model class references it'] });
  assert.match(buildAnimations(dump({ modelIds: [] }), []).findings[0], /no model accepted by net\.minecraft\.client\.model\.FrogModel/);
  const repeated = dump();
  repeated[0].animations.FROG_JUMP.bones.body.push({ target: 'rotation', keyframes: [keyframe(0)] });
  assert.throws(() => buildAnimations(repeated, [model('minecraft:frog', {}), model('minecraft:frog_baby', {})]), /several rotation channels for body/);
});

test('animation schema rejects malformed files', () => {
  const valid = () => ({
    id: 'minecraft:frog',
    animations: { jump: { length: 0.5, loop: false, bones: { body: { rotation: [keyframe(0), { ...keyframe(0.5), pre: [1, 0, 0] }] } } } },
  });
  const rejects = change => {
    const data = valid();
    change(data, data.animations.jump);
    assert.throws(() => validateAnimations(data));
  };
  validateAnimations(valid());
  rejects(data => { data.layers = {}; });
  rejects(data => { data.animations = {}; });
  rejects(data => { data.animations.Jump = data.animations.jump; });
  rejects((data, jump) => { delete jump.loop; });
  rejects((data, jump) => { jump.length = '0.5'; });
  rejects((data, jump) => { jump.bones = {}; });
  rejects((data, jump) => { jump.bones.body = { shear: [keyframe(0)] }; });
  rejects((data, jump) => { jump.bones.body.rotation = []; });
  rejects((data, jump) => { jump.bones.body.rotation = [keyframe(0.5), keyframe(0)]; });
  rejects((data, jump) => { jump.bones.body.rotation[0].value = [0, 0]; });
  rejects((data, jump) => { jump.bones.body.rotation[0].interpolation = 'step'; });
  rejects((data, jump) => { jump.bones.body.rotation[1].pre = [0, 0, 0]; });
  validateAnimationFile('animations/minecraft/frog.json', valid());
  assert.throws(() => validateAnimationFile('animations/minecraft/toad.json', valid()), /does not match its path/);
  assert.throws(() => validateAnimationFile('animations/frog.json', valid()), /Unexpected file/);
  assert.throws(() => validateAnimationFile('animations/minecraft/frog.json', { id: 'minecraft:frog' }), /animations\/minecraft\/frog\.json: Expected object/);
});

test('the dataset writer adds the animation tree only when there are animations', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'entity-models-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const records = [model('minecraft:frog', { body: { tongue: {} } }), model('minecraft:frog_baby', { body: { tongue: {} } })];
  const { animations } = buildAnimations(dump(), records);
  assert.equal(await writeDataset(path.join(temporary, 'with'), { id: '1.21.11' }, records, { animations }), 4);
  assert.deepEqual(JSON.parse(await readFile(path.join(temporary, 'with', '_list.json'), 'utf8')),
    { directories: ['animations', 'minecraft'], files: ['version.json'] });
  assert.deepEqual(JSON.parse(await readFile(path.join(temporary, 'with', 'animations', '_list.json'), 'utf8')),
    { directories: ['minecraft'], files: [] });
  assert.deepEqual(JSON.parse(await readFile(path.join(temporary, 'with', 'animations', 'minecraft', '_list.json'), 'utf8')),
    { directories: [], files: ['frog.json', 'frog_baby.json'] });
  const written = await readFile(path.join(temporary, 'with', 'animations', 'minecraft', 'frog.json'), 'utf8');
  assert.ok(written.startsWith('{"animations":{"idle_water":{"bones":{"body":{"rotation":[{"interpolation":"linear","time":0,"value":[0,0,0]}]}},"length":3,"loop":true},"jump":'));
  await writeDataset(path.join(temporary, 'without'), { id: '1.17.1' }, records);
  assert.deepEqual((await readdir(path.join(temporary, 'without'))).sort(), ['_list.json', 'minecraft', 'version.json']);
  await assert.rejects(writeDataset(path.join(temporary, 'invalid'), { id: '1.21.11' }, records, { animations: [{ id: 'minecraft:frog', animations: {} }] }),
    /animations\/minecraft:frog: Expected at least one animation/);
});
