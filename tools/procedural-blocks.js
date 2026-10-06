import { clip } from './procedural-sampling.js';

const f = Math.fround;

// Chest, shulker box, and enchanting book controllers change progress by 0.1 per tick.
function progress(opening) {
  const ticks = [opening ? 0 : 1];
  for (let tick = 0; tick < 10; tick++) {
    ticks.push(Math.max(0, Math.min(1, f(ticks[tick] + (opening ? f(0.1) : -f(0.1))))));
  }
  return time => {
    const tick = Math.min(10, Math.floor(time * 20));
    if (tick === 10) return ticks[tick];
    return f(ticks[tick] + f(f(time * 20 - tick) * f(ticks[tick + 1] - ticks[tick])));
  };
}

function transitions(valuesAt) {
  return Object.fromEntries([['open', true], ['close', false]].map(([name, opening]) => {
    const openness = progress(opening);
    return [name, clip(0.5, false, time => valuesAt(openness(time), time))];
  }));
}

// ChestRenderer eases controller progress before passing it to ChestModel.
function chestOpenness(value) {
  const closed = f(1 - value);
  return f(1 - f(f(closed * closed) * closed));
}

export function blockAnimations(modelIds) {
  const ids = new Set(modelIds);
  const requests = [];
  const add = (models, className, parameters, clips, layer) => {
    models = models.map(id => `minecraft:${id}`).filter(id => ids.has(id));
    if (!models.length) return;
    requests.push({ class: className, models, method: 'setupAnim', parameters, clips, ...(layer ? { layer } : {}) });
  };

  add(['chest', 'double_chest_left', 'double_chest_right'],
    'net.minecraft.client.model.object.chest.ChestModel', ['java.lang.Float'],
    transitions(value => [chestOpenness(value)]));

  add(['shulker_box'], 'net.minecraft.client.renderer.blockentity.ShulkerBoxRenderer$ShulkerBoxModel',
    ['java.lang.Float'], transitions(value => [value]));

  // BellBlockEntity stops shaking at tick 50; the final frame preserves that jump to rest.
  add(['bell'], 'net.minecraft.client.model.object.bell.BellModel',
    ['net.minecraft.client.model.object.bell.BellModel$State'],
    Object.fromEntries(['north', 'south', 'east', 'west'].map(direction => [
      `ring_${direction}`,
      clip(2.5, false, time => [{ ticks: time * 20, shakeDirection: direction.toUpperCase() }],
        { end: [{ ticks: 0, shakeDirection: null }] }),
    ])));

  // BannerRenderer advances phase once per 100 ticks; block position only shifts its start.
  add(['standing_banner', 'wall_banner'], 'net.minecraft.client.model.object.banner.BannerFlagModel',
    ['java.lang.Float'], { sway: clip(5, true, time => [time / 5]) }, 'flag');

  const skullState = time => [{ animationPos: time * 20, xRot: 0, yRot: 0 }];
  add(['dragon_skull'], 'net.minecraft.client.model.object.skull.DragonHeadModel',
    ['net.minecraft.client.model.object.skull.SkullModelBase$State'], { jaw: clip(0.5, true, skullState) });
  // Piglin ears run at different speeds and return to their shared phase after 50 ticks.
  add(['piglin_head'], 'net.minecraft.client.model.object.skull.PiglinHeadModel',
    ['net.minecraft.client.model.object.skull.SkullModelBase$State'], { ears: clip(2.5, true, skullState) });

  // These clips hold EnchantTableRenderState.flip at zero. Random page turns and the renderer's
  // world-space bobbing and player tracking are independent of the model's opening pose.
  const bookState = (open, time) => [{ animationPos: time * 20, pageFlip1: f(f(f(0.25) * f(1.6)) - f(0.3)),
    pageFlip2: f(f(f(0.75) * f(1.6)) - f(0.3)), open }];
  add(['book'], 'net.minecraft.client.model.object.book.BookModel',
    ['net.minecraft.client.model.object.book.BookModel$State'], {
      ...transitions(bookState),
      // Continue the age reached by open so the two clips share their connecting pose.
      idle: clip(5 * Math.PI, true, time => bookState(1, time + 0.5)),
    });

  return requests;
}
