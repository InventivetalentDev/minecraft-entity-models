import { blockAnimations } from './procedural-blocks.js';
import { remapClips, minecraftSin as sin, minecraftCos as cos } from './procedural-sampling.js';

const f = Math.fround;
const PI = f(Math.PI);

// Before render-state models, these poses are calculated inside the block renderers.
// The float operations and Mth table lookup match the reviewed 1.17.1 and 1.20.1 bytecode.
export function classicBlockAnimations(modelIds) {
  const available = new Set(modelIds);
  const requests = [];
  const modern = blockAnimations(['minecraft:chest', 'minecraft:double_chest_left', 'minecraft:double_chest_right',
    'minecraft:shulker_box', 'minecraft:bell', 'minecraft:standing_banner', 'minecraft:wall_banner', 'minecraft:dragon_skull', 'minecraft:piglin_head', 'minecraft:book']);
  for (const request of modern) {
    const source = request.models[0].slice(10);
    const models = request.models.filter(id => available.has(id));
    const rawBanner = source === 'standing_banner' && available.has('minecraft:banner');
    if (!models.length && !rawBanner) continue;
    const poses = (renderer, convert, modelLayer, targets = models, layer = request.layer) => requests.push({ class: `net.minecraft.client.renderer.blockentity.${renderer}`,
      models: targets, poses: true, ...(layer ? { layer } : {}), ...(modelLayer ? { modelLayer } : {}),
      clips: remapClips(request.clips, convert) });
    switch (source) {
      case 'chest':
        poses('ChestRenderer', ([open]) => {
          const xRot = -f(f(open) * f(Math.PI / 2));
          return [{ lid: { xRot }, lock: { xRot } }];
        });
        break;
      case 'shulker_box':
        poses('ShulkerBoxRenderer', ([open]) => [{ lid: { x: 0, y: f(24 - f(f(f(open) * 0.5) * 16)), z: 0,
          yRot: f(f(270 * f(open)) * f(0.017453292)) } }], { model: 'minecraft:shulker', layer: 'main' });
        break;
      case 'bell':
        poses('BellRenderer', ([{ ticks, shakeDirection }]) => {
          const amount = shakeDirection ? f(sin(f(f(ticks) / PI)) / f(4 + f(f(ticks) / 3))) : 0;
          return [{ bell_body: { xRot: shakeDirection === 'NORTH' ? -amount : shakeDirection === 'SOUTH' ? amount : 0,
            zRot: shakeDirection === 'EAST' ? -amount : shakeDirection === 'WEST' ? amount : 0 } }];
        });
        break;
      case 'standing_banner': {
        const pose = ([phase]) => [{ flag: { y: -32,
          xRot: f(f(f(-0.0125) + f(f(0.01) * cos(f(f(Math.PI * 2) * f(phase))))) * PI) } }];
        if (models.length) poses('BannerRenderer', pose,
          { model: 'minecraft:banner', layer: 'main', poses: { flag: { y: -32 } } });
        if (rawBanner) poses('BannerRenderer', pose, undefined, ['minecraft:banner'], 'main');
        break;
      }
      case 'book':
        requests.push({ class: 'net.minecraft.client.model.BookModel', models, method: 'setupAnim', parameters: Array(4).fill('float'),
          clips: remapClips(request.clips, ([state]) => [state.animationPos, state.pageFlip1, state.pageFlip2, state.open]) });
        break;
      case 'dragon_skull':
      case 'piglin_head':
        requests.push({ class: `net.minecraft.client.model.${source === 'dragon_skull' ? 'dragon.DragonHeadModel' : 'PiglinHeadModel'}`,
          models, method: 'setupAnim', parameters: Array(3).fill('float'),
          clips: remapClips(request.clips, ([state]) => [state.animationPos, state.yRot, state.xRot]) });
        break;
    }
  }
  return requests;
}
