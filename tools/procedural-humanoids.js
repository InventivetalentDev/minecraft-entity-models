import { clip } from './procedural-sampling.js';

const MODEL = 'net.minecraft.client.model.';
const STATE = 'net.minecraft.client.renderer.entity.state.';
const WALK_PERIOD = 2 * Math.PI / Math.fround(0.6662) / 20;

// Walk phase advances once per tick at speed 1. Age stays zero so idle arm motion does not change the cycle.
function walk(fields = {}, loop = true) {
  return clip(WALK_PERIOD, loop, time => [{
    ageInTicks: 0, speedValue: 1, walkAnimationPos: time * 20, walkAnimationSpeed: 1, ...fields,
  }], { samplesPerSecond: 240 });
}

export function humanoidAnimations(modelIds, records = []) {
  const available = new Set(modelIds);
  const requests = [];
  function add(model, ids, state, clips, constructor) {
    const models = ids.map(id => `minecraft:${id}`).filter(id => available.has(id));
    if (!models.length) return;
    requests.push({ class: MODEL + model, models, method: 'setupAnim', parameters: [STATE + state], clips,
      ...(constructor ? { constructor } : {}) });
  }

  for (const [model, ids, state] of [
    ['monster.skeleton.SkeletonModel', ['skeleton', 'stray', 'wither_skeleton'], 'SkeletonRenderState'],
    ['monster.skeleton.BoggedModel', ['bogged'], 'BoggedRenderState'],
    ['monster.zombie.ZombieModel', ['zombie', 'zombie_baby', 'husk', 'husk_baby'], 'ZombieRenderState'],
    ['monster.zombie.DrownedModel', ['drowned', 'drowned_baby'], 'ZombieRenderState'],
    ['monster.zombie.GiantZombieModel', ['giant'], 'ZombieRenderState'],
    ['monster.zombie.ZombieVillagerModel',
      ['zombie_villager', 'zombie_villager_baby', 'zombie_villager_no_hat', 'zombie_villager_baby_no_hat'],
      'ZombieVillagerRenderState'],
    ['monster.enderman.EndermanModel', ['enderman'], 'EndermanRenderState'],
  ]) add(model, ids, state, { walk_cycle: walk() });

  for (const slim of [false, true]) {
    add('player.PlayerModel', [slim ? 'player_slim' : 'player'], 'AvatarRenderState',
      { walk_cycle: walk() }, { parameters: ['boolean'], values: [slim] });
  }

  // Piglin ears use different walk frequencies from the limbs, so a single stride is not a complete loop.
  add('monster.piglin.PiglinModel', ['piglin', 'piglin_baby', 'piglin_brute'], 'PiglinRenderState',
    { walk_sample: walk({ armPose: 'DEFAULT' }, false) });
  add('monster.piglin.ZombifiedPiglinModel', ['zombified_piglin', 'zombified_piglin_baby'],
    'ZombifiedPiglinRenderState', { walk_sample: walk({}, false) });

  // NEUTRAL uses the separate arms and hides the crossed-arms part; visibility is selected by the caller.
  add('monster.illager.IllagerModel', ['pillager', 'vindicator', 'evoker', 'illusioner'], 'IllagerRenderState',
    { walk_cycle: walk({ armPose: 'NEUTRAL' }) });

  // Armor and clothing layers pose their own models with the same state as the main model.
  const layers = new Map(records.map(record => [record.id, record.layers]));
  for (const request of [...requests]) {
    for (const layer of ['boots', 'chestplate', 'helmet', 'leggings', 'outer']) {
      const models = request.models.filter(id => layers.get(id)?.[layer]);
      if (!models.length) continue;
      const overlay = { ...request, models, layer,
        clips: Object.fromEntries(Object.entries(request.clips).map(([name, animation]) => [`${name}_${layer}`, animation])) };
      // Bogged armor and outer clothing use SkeletonModel, without the main model's mushroom parts.
      if (request.class === MODEL + 'monster.skeleton.BoggedModel') {
        overlay.class = MODEL + 'monster.skeleton.SkeletonModel';
        overlay.parameters = [STATE + 'SkeletonRenderState'];
      }
      requests.push(overlay);
    }
  }

  return requests;
}
