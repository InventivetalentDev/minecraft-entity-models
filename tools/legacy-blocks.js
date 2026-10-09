import { expandBlocks, loadBlockFamilies } from './blocks.js';
import { clip, linearTransitions, minecraftSin as sin, minecraftCos as cos } from './procedural-sampling.js';

const f = Math.fround;
const PI = f(Math.PI);

function select(source, names) {
  const layer = structuredClone(source);
  layer.root.children = Object.fromEntries(names.map(name => {
    if (!source.root.children[name]) throw new Error(`Missing legacy block part: ${name}`);
    return [name, structuredClone(source.root.children[name])];
  }));
  return layer;
}

export async function addLegacyBlockLayers(records, blockIds) {
  const models = new Map(records.map(model => [model.id.slice(10), model]));
  const add = (id, source, names) => {
    const model = { id: `minecraft:${id}`, layers: { main: select(models.get(source).layers.main, names) } };
    records.push(model);
    models.set(id, model);
    return model;
  };
  const chest = models.get('chest');
  chest.layers.single = select(chest.layers.main, ['singleChestLid', 'singleChestBase', 'singleChestLatch']);
  for (const side of ['left', 'right']) add(`double_chest_${side}`, 'chest',
    ['Lid', 'Base', 'Latch'].map(part => `doubleChest${side[0].toUpperCase() + side.slice(1)}${part}`));
  add('bed_head', 'bed', ['field_20813', 'legs_1', 'legs_3']);
  add('bed_foot', 'bed', ['field_20814', 'legs_0', 'legs_2']);
  const families = await loadBlockFamilies();
  for (const wood of families.sets.wood) {
    if (!blockIds.has(`minecraft:${wood}_sign`)) continue;
    add(`sign/standing/${wood}`, 'sign', ['field', 'foot']);
    add(`sign/wall/${wood}`, 'sign', ['field']);
  }
  for (const kind of ['standing', 'wall']) {
    const banner = add(`${kind}_banner`, 'banner', kind === 'standing' ? ['pillar', 'crossbar'] : ['crossbar']);
    banner.layers.flag = select(models.get('banner').layers.main, ['banner']);
    banner.layers.flag.root.children.banner.pose.offset[1] = -32;
  }
  models.get('conduit').layers.shell = select(models.get('conduit').layers.main, ['field_20825']);
  models.get('shulker_box').layers.shell = select(models.get('shulker_box').layers.main, ['bottomShell', 'topShell']);
  for (const family of families.families) for (const part of family.parts) {
    if (part.model === 'chest') part.layer = 'single';
    if (part.model === 'shulker_box') part.layer = 'shell';
  }
  return expandBlocks(families, records, blockIds);
}

export function placeLegacyBanners(records) {
  for (const model of records) {
    if (model.id === 'minecraft:standing_banner') model.transform = [
      { translate: [8, 8, 8] }, { scale: [0.6666667, -0.6666667, -0.6666667] },
    ];
    if (model.id === 'minecraft:wall_banner') model.transform = [
      { translate: [8, Math.fround(-1 / 6) * 16, 8] }, { translate: [0, -5, -7] }, { scale: [0.6666667, -0.6666667, -0.6666667] },
    ];
  }
}

// These renderers change parts directly instead of exposing a model animation method in 1.16.5.
export function legacyBlockAnimations(records) {
  const result = [];
  const add = (model, layer, clips) => result.push({ class: 'LegacyBlockRenderer', modelClasses: ['LegacyBlockRenderer'],
    modelIds: [`minecraft:${model}`], layer, animations: clips });
  function poses(length, loop, at, end) {
    const sampled = clip(length, loop, at, end ? { end } : {});
    const bones = {};
    for (const bone of Object.keys(sampled.frames[0].values)) {
      bones[bone] = Object.keys(sampled.frames[0].values[bone]).map(target => ({ target,
        keyframes: sampled.frames.map(frame => ({ time: frame.time, value: frame.values[bone][target], interpolation: 'linear',
          ...(frame.pre ? { pre: frame.pre[bone][target] } : {}) })) }));
    }
    return { length, loop, bones };
  }
  for (const model of ['chest', 'trapped_chest', 'ender_chest', 'double_chest_left', 'double_chest_right']) {
    const record = records.find(record => record.id === `minecraft:${model}`);
    for (const layer of ['main', 'single']) {
      if (!record.layers[layer]) continue;
      const parts = Object.keys(record.layers[layer].root.children).filter(name => /(?:Lid|Latch)$/.test(name));
      const clips = linearTransitions(progress => {
        const closed = f(1 - f(progress));
        const angle = -f(f(1 - f(f(closed * closed) * closed)) * f(PI / 2));
        return Object.fromEntries(parts.map(name => [name, { rotation: [angle, 0, 0] }]));
      }, poses);
      add(model, layer, Object.fromEntries(Object.entries(clips).map(([name, value]) => [layer === 'main' ? name : `${name}_${layer}`, value])));
    }
  }
  for (const layer of ['main', 'shell']) add('shulker_box', layer,
    Object.fromEntries(Object.entries(linearTransitions(open => ({ topShell: {
      position: [0, -f(f(open) * 8), 0], rotation: [0, f(f(f(270 * f(open)) * PI) / 180), 0],
    } }), poses)).map(([name, value]) => [layer === 'main' ? name : `${name}_${layer}`, value])));
  for (const [direction, axis, sign] of [['north', 0, -1], ['south', 0, 1], ['east', 2, -1], ['west', 2, 1]]) {
    add('bell', 'main', { [`ring_${direction}`]: poses(2.5, false, time => {
      const ticks = f(time * 20), vector = [0, 0, 0];
      vector[axis] = f(sign * f(sin(f(ticks / PI)) / f(4 + f(ticks / 3))));
      return { field_20816: { rotation: vector } };
    }, { field_20816: { rotation: [0, 0, 0] } }) });
  }
  for (const model of ['banner', 'standing_banner', 'wall_banner']) add(model, model === 'banner' ? 'main' : 'flag', {
    sway: poses(5, true, time => ({ banner: { rotation: [f(f(f(-0.0125) + f(f(0.01) * cos(f(f(2 * PI) * f(time / 5))))) * PI), 0, 0],
      ...(model === 'banner' ? { position: [0, -32, 0] } : {}) } })),
  });
  return result;
}
