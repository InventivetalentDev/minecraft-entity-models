import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { blockTextureRecords, expandBlocks, loadBlockFamilies, validateBlocks } from '../tools/blocks.js';
import { writeDataset } from '../tools/lib.js';

function model(name, layers = { main: undefined }) {
  return {
    id: `minecraft:${name}`,
    transform: [],
    layers: Object.fromEntries(Object.entries(layers).map(([layer, texture]) => [layer, {
      texture: [64, 64],
      ...(texture ? { textureLocation: `minecraft:textures/entity/${texture}.png` } : {}),
      root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} },
    }])),
  };
}

const records = [
  model('chest', { main: 'chest/normal' }),
  model('double_chest_left', { main: 'chest/normal_left' }),
  model('double_chest_right', { main: 'chest/normal_right' }),
  model('bed_head', { main: 'bed/red' }),
  model('bed_foot', { main: 'bed/red' }),
  model('skeleton_skull', { main: 'skeleton/skeleton' }),
  model('standing_banner', { main: 'banner_base', flag: 'banner_base' }),
  model('sign/standing/oak', { main: 'signs/oak' }),
];
const facing = { property: 'facing', degrees: { south: 0, west: 270, north: 180, east: 90 } };

test('block families expand to parts, textures and rotations', async () => {
  const index = expandBlocks(await loadBlockFamilies(), records);
  assert.deepEqual(index['minecraft:trapped_chest'], {
    parts: [
      { model: 'minecraft:chest', textureLocation: 'minecraft:textures/entity/chest/trapped.png', when: { type: 'single' } },
      { model: 'minecraft:double_chest_left', textureLocation: 'minecraft:textures/entity/chest/trapped_left.png', when: { type: 'left' } },
      { model: 'minecraft:double_chest_right', textureLocation: 'minecraft:textures/entity/chest/trapped_right.png', when: { type: 'right' } },
    ],
    rotation: facing,
  });
  assert.deepEqual(index['minecraft:chest'].parts[0], { model: 'minecraft:chest', when: { type: 'single' } });
  assert.deepEqual(index['minecraft:waxed_exposed_copper_chest'].parts[1].textureLocation, 'minecraft:textures/entity/chest/copper_exposed_left.png');
  assert.deepEqual(index['minecraft:red_bed'].parts, [
    { model: 'minecraft:bed_head', when: { part: 'head' } },
    { model: 'minecraft:bed_foot', when: { part: 'foot' } },
  ]);
  assert.equal(index['minecraft:blue_bed'].parts[1].textureLocation, 'minecraft:textures/entity/bed/blue.png');
  assert.deepEqual(index['minecraft:skeleton_skull'], { parts: [{ model: 'minecraft:skeleton_skull' }], rotation: { property: 'rotation', step: -22.5 } });
  assert.deepEqual(index['minecraft:skeleton_wall_skull'], {
    parts: [{ model: 'minecraft:skeleton_skull' }],
    rotation: { property: 'facing', degrees: { north: 0, east: 270, south: 180, west: 90 } },
    translation: [0, 4, 4],
  });
  assert.deepEqual(index['minecraft:white_banner'].parts, [{ model: 'minecraft:standing_banner' }, { model: 'minecraft:standing_banner', layer: 'flag' }]);
  assert.deepEqual(blockTextureRecords({ 'minecraft:blue_bed': index['minecraft:blue_bed'] })[0].layers['part 0'].textureLocation,
    'minecraft:textures/entity/bed/blue.png');
});

test('families without a model or a block in the version produce no entries', async () => {
  const data = await loadBlockFamilies();
  for (const family of data.families) assert.ok(family.note?.length > 20, `${family.block} needs an evidence note`);
  const index = expandBlocks(data, [records[0], records[7]], new Set(['minecraft:chest', 'minecraft:oak_sign', 'minecraft:red_bed']));
  assert.deepEqual(Object.keys(index), ['minecraft:chest', 'minecraft:oak_sign']);
  assert.deepEqual(index['minecraft:chest'].parts, [{ model: 'minecraft:chest', when: { type: 'single' } }]);
  assert.deepEqual(expandBlocks(data, []), {});
});

test('block index validation rejects malformed entries', () => {
  const entry = () => ({ parts: [{ model: 'minecraft:chest', when: { type: 'left|right' } }], rotation: structuredClone(facing) });
  assert.doesNotThrow(() => validateBlocks({ 'minecraft:chest': entry() }));
  const invalid = [
    index => { index.chest = index['minecraft:chest']; },
    index => { index['minecraft:chest'].parts = []; },
    index => { index['minecraft:chest'].parts[0].model = 'chest'; },
    index => { index['minecraft:chest'].parts[0].layer = 'main'; },
    index => { index['minecraft:chest'].parts[0].textureLocation = 'minecraft:entity/chest.png'; },
    index => { index['minecraft:chest'].parts[0].when = { type: true }; },
    index => { index['minecraft:chest'].parts[0].extra = 1; },
    index => { index['minecraft:chest'].rotation.step = -22.5; },
    index => { index['minecraft:chest'].rotation.degrees.south = 360; },
    index => { index['minecraft:chest'].translation = [0, 0, 0]; },
  ];
  for (const change of invalid) {
    const index = { 'minecraft:chest': entry() };
    change(index);
    assert.throws(() => validateBlocks(index), change.toString());
  }
});

test('the dataset writer writes blocks.json and publish accepts it', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'minecraft-entity-models-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = { 'minecraft:chest': { parts: [{ model: 'minecraft:chest' }], rotation: facing } };
  await assert.rejects(writeDataset(path.join(directory, 'invalid'), { id: '1.0' }, [records[0]], { blocks: { chest: {} } }), /chest/);
  const output = path.join(directory, 'dataset');
  assert.equal(await writeDataset(output, { id: '1.0' }, [records[0]], { blocks: index }), 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'blocks.json'), 'utf8')), index);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, '_list.json'), 'utf8')).files, ['blocks.json', 'version.json']);

  const repository = path.join(directory, 'repository');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  const run = (command, args) => spawnSync(command, args, { cwd: repository, env, encoding: 'utf8' });
  assert.equal(spawnSync('git', ['init', '--quiet', repository], { encoding: 'utf8' }).status, 0);
  assert.equal(run('git', ['commit', '--quiet', '--allow-empty', '-m', 'initial']).status, 0);
  const publish = fileURLToPath(new URL('../tools/publish.js', import.meta.url));
  const published = run(process.execPath, [publish, '--version', '1.0', '--input', output]);
  assert.equal(published.status, 0, published.stderr);
  assert.match(run('git', ['ls-tree', '-r', '--name-only', '1.0']).stdout, /^blocks\.json$/m);
  await writeFile(path.join(output, 'blocks.json'), '{"minecraft:chest":{"parts":[]}}');
  const rejected = run(process.execPath, [publish, '--version', '1.0', '--input', output]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /minecraft:chest: Expected at least one part/);
});
