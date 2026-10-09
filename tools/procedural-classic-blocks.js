import { blockAnimations } from './procedural-blocks.js';

const f = Math.fround;
const PI = f(Math.PI);
const sin = angle => f(Math.sin((Math.trunc(f(f(angle) * f(10430.378))) & 65535) * Math.PI * 2 / 65536));
const cos = angle => f(Math.sin((Math.trunc(f(f(f(angle) * f(10430.378)) + 16384)) & 65535) * Math.PI * 2 / 65536));

function mapClips(clips, convert, rename = name => name) {
  return Object.fromEntries(Object.entries(clips).map(([name, animation]) => [rename(name), {
    ...animation,
    frames: animation.frames.map(frame => ({ ...frame, values: convert(frame.values), ...(frame.pre ? { pre: convert(frame.pre) } : {}) })),
  }]));
}

// Before render-state models, these poses are calculated inside the block renderers.
// The float operations and Mth table lookup match the reviewed 1.17.1 and 1.20.1 bytecode.
export function classicBlockAnimations(modelIds) {
  const available = new Set(modelIds);
  const requests = [];
  const modern = blockAnimations(['minecraft:chest', 'minecraft:double_chest_left', 'minecraft:double_chest_right',
    'minecraft:shulker_box', 'minecraft:bell', 'minecraft:standing_banner', 'minecraft:dragon_skull', 'minecraft:piglin_head', 'minecraft:book']);
  for (const request of modern) {
    const source = request.models[0].slice(10);
    const target = source === 'standing_banner' ? ['minecraft:banner'] : source === 'shulker_box' ? ['minecraft:shulker'] : request.models;
    const models = target.filter(id => available.has(id));
    if (!models.length) continue;
    const poses = (renderer, convert, rename) => requests.push({ class: `net.minecraft.client.renderer.blockentity.${renderer}`,
      models, poses: true, clips: mapClips(request.clips, convert, rename) });
    switch (source) {
      case 'chest':
        poses('ChestRenderer', ([open]) => {
          const xRot = -f(f(open) * f(Math.PI / 2));
          return [{ lid: { xRot }, lock: { xRot } }];
        });
        break;
      case 'shulker_box':
        poses('ShulkerBoxRenderer', ([open]) => [{ lid: { x: 0, y: f(24 - f(f(f(open) * 0.5) * 16)), z: 0,
          yRot: f(f(270 * f(open)) * f(0.017453292)) } }], name => `${name}_box`);
        break;
      case 'bell':
        poses('BellRenderer', ([{ ticks, shakeDirection }]) => {
          const amount = shakeDirection ? f(sin(f(f(ticks) / PI)) / f(4 + f(f(ticks) / 3))) : 0;
          return [{ bell_body: { xRot: shakeDirection === 'NORTH' ? -amount : shakeDirection === 'SOUTH' ? amount : 0,
            zRot: shakeDirection === 'EAST' ? -amount : shakeDirection === 'WEST' ? amount : 0 } }];
        });
        break;
      case 'standing_banner':
        poses('BannerRenderer', ([phase]) => [{ flag: { y: -32,
          xRot: f(f(f(-0.0125) + f(f(0.01) * cos(f(f(Math.PI * 2) * f(phase))))) * PI) } }]);
        break;
      case 'book':
        requests.push({ class: 'net.minecraft.client.model.BookModel', models, method: 'setupAnim', parameters: Array(4).fill('float'),
          clips: mapClips(request.clips, ([state]) => [state.animationPos, state.pageFlip1, state.pageFlip2, state.open]) });
        break;
      case 'dragon_skull':
      case 'piglin_head':
        requests.push({ class: `net.minecraft.client.model.${source === 'dragon_skull' ? 'dragon.DragonHeadModel' : 'PiglinHeadModel'}`,
          models, method: 'setupAnim', parameters: Array(3).fill('float'),
          clips: mapClips(request.clips, ([state]) => [state.animationPos, state.yRot, state.xRot]) });
        break;
    }
  }
  for (const [source, aliases, layer] of [['banner', ['standing_banner', 'wall_banner'], 'flag'], ['shulker', ['shulker_box'], 'main']]) {
    const original = requests.find(request => request.models.includes(`minecraft:${source}`));
    const models = aliases.map(id => `minecraft:${id}`).filter(id => available.has(id));
    if (!original || !models.length) continue;
    requests.push({ ...original, models, modelLayer: { model: `minecraft:${source}`, layer: 'main', ...(source === 'banner' ? { poses: { flag: { y: -32 } } } : {}) },
      ...(layer === 'main' ? {} : { layer }),
      clips: source === 'shulker' ? Object.fromEntries(Object.entries(original.clips).map(([name, animation]) => [name.replace(/_box$/, ''), animation])) : original.clips });
  }
  return requests;
}
