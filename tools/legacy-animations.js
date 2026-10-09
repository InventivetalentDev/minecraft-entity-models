import { clip, countdown as countdownClip, remapClips, steppedClip, squidTentacleAngle } from './procedural-sampling.js';
import { entityAnimations } from './procedural-entities.js';

const period = frequency => 2 * Math.PI / Math.fround(frequency) / 20;
const PERIOD = period(0.6662);
const countdown = (ticks, getter) => countdownClip(ticks, (left, partial) => [{ [getter]: left }, 0, 0, partial]);

export function legacyAnimationRequests(inventory) {
  const requests = [];
  const add = (id, clips, options = {}) => {
    const model = `minecraft:${id}`;
    if (!inventory[model]) throw new Error(`Missing legacy model: ${model}`);
    requests.push({ model, clips, ...options });
  };
  const walk = (fields, frequency = 0.6662, loop = true) => clip(period(frequency), loop, time => [{ ...fields }, time * 20, 1, 0, 0, 0], { samplesPerSecond: 240 });
  for (const id of ['cow', 'mooshroom', 'pig', 'sheep', 'chicken', 'creeper', 'spider', 'cave_spider',
    'llama', 'trader_llama', 'polar_bear', 'panda', 'ocelot', 'cat', 'fox', 'wolf', 'horse', 'donkey', 'mule',
    'skeleton_horse', 'zombie_horse', 'ravager', 'villager', 'wandering_trader',
    'zombie', 'husk', 'drowned', 'zombie_villager', 'giant', 'skeleton', 'stray', 'wither_skeleton',
    'enderman', 'player', 'player_slim', 'pillager', 'vindicator', 'evoker', 'illusioner']) {
    const loop = !['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'cat', 'ocelot'].includes(id);
    add(id, { [loop ? 'walk_cycle' : 'walk_sample']: walk({}, 0.6662, loop) });
  }
  add('iron_golem', { walk_cycle: clip(0.65, true, time => [{}, time * 20, 1, 0, 0, 0]) });
  add('iron_golem', { attack: countdown(10, 'getAttackTicksLeft') }, { method: 'animateModel' });
  add('ravager', { attack: countdown(10, 'getAttackTick'), stunned: countdown(40, 'getStunTick'), roar: countdown(20, 'getRoarTick') },
    { method: 'animateModel' });
  for (const id of ['piglin', 'piglin_brute', 'zombified_piglin']) {
    const entityClass = id === 'piglin' ? 'PiglinEntity' : id === 'piglin_brute' ? 'PiglinBruteEntity' : 'ZombifiedPiglinEntity';
    const animation = walk({ getType: `minecraft:${id}` });
    animation.loop = false;
    add(id, { walk_sample: animation }, { entityClass: `net.minecraft.entity.mob.${entityClass}` });
  }
  for (const id of ['hoglin', 'zoglin']) add(id, { walk_cycle: walk({}, 1) }, {
    entityClass: `net.minecraft.entity.mob.${id === 'hoglin' ? 'HoglinEntity' : 'ZoglinEntity'}`,
  });
  const age = (frequency, fields = {}) => clip(2 * Math.PI / Math.fround(frequency) / 20, true,
    time => [{ ...fields }, 0, 0, time * 20, 0, 0]);
  for (const id of ['cod', 'salmon']) add(id, { swim: age(0.6, { isTouchingWater: true }) });
  for (const size of ['small', 'large']) add(`tropical_fish_${size}`, { swim: age(0.6, { isTouchingWater: true }) });
  for (const size of ['small', 'medium', 'big']) add(`pufferfish_${size}`, { swim: age(0.2) });
  add('dolphin', { swim: age(0.3, { getVelocity: [0.1, 0, 0] }) });
  add('bat', { fly: age(0.1) });
  add('phantom', { fly: age(0.13) });
  add('vex', { fly_sample: clip(2, false, time => [{}, 0, 0, time * 20, 0, 0]) });
  add('ghast', { tentacles: age(0.3) });
  add('blaze', { rods: clip(2, false, time => [{}, 0, 0, time * 20, 0, 0]) });
  add('endermite', { crawl: age(0.9) });
  add('silverfish', { crawl: age(0.9) });
  add('bee', { fly: age(0.06), fly_angry: age(2.1, { getAngerTime: 1 }) });
  for (const id of ['parrot', 'chicken']) add(id, { fly: clip(period(1.8), true,
    time => [{ ...(id === 'parrot' ? { isInAir: true } : {}) }, 0, 0, Math.sin(time * 20 * Math.fround(1.8)) + 1, 0, 0], { samplesPerSecond: 480 }) });
  const danceValues = tick => [{ getSongPlaying: true, age: tick }, 0, 0, 0, 0, 0];
  add('parrot', { dance_sample: steppedClip(40, danceValues) });
  add('rabbit', { jump: clip(0.5, false, time => [{ getJumpProgress: time * 2 }, 0, 0, time * 20, 0, 0]) });
  add('squid', { swim_cycle: clip(1.6, true, time => {
    const tick = Math.floor(time * 20), partial = time * 20 - tick;
    return [{}, 0, 0, squidTentacleAngle(tick) + (squidTentacleAngle(tick + 1) - squidTentacleAngle(tick)) * partial, 0, 0];
  }, { samplesPerSecond: 240 }) });
  const row = (left, right) => clip(0.8, true, time => [{ interpolatePaddlePhase: { byIndex: [
    left ? time * 20 * Math.fround(0.3926991) : 0, right ? time * 20 * Math.fround(0.3926991) : 0,
  ] } }, 0, 0, 0, 0, 0]);
  add('boat', { row: row(true, true), row_left: row(true, false), row_right: row(false, true) });
  add('turtle', { swim_cycle: walk({ isTouchingWater: true }, Math.fround(0.6662) / 5) });
  add('strider', { idle: age(0.2), walk_sample: clip(PERIOD, false, time => [{}, time * 20, 1, time * 20, 0, 0]) });
  add('evoker_fangs', { bite: clip(1, false, time => [{}, time, 0, 0, 0, 0]) });
  add('wither', { idle: age(0.1) });
  const transitions = values => Object.fromEntries([['open', true], ['close', false]].map(([name, opening]) => [name,
    clip(0.5, false, time => values(opening ? time * 2 : 1 - time * 2, time))]));
  const controllers = entityAnimations(['minecraft:sheep', 'minecraft:shulker', 'minecraft:guardian', 'minecraft:elder_guardian']);
  const shulker = controllers.find(request => request.clips.open && request.models.includes('minecraft:shulker'));
  add('shulker', remapClips(shulker.clips, ([state]) => [{ getOpenProgress: state.peekAmount }, 0, 0, state.ageInTicks, 0, 0]));
  const sheep = controllers.find(request => request.clips.eat);
  add('sheep', remapClips(sheep.clips, ([state]) => [{ getNeckAngle: state.headEatPositionScale, getHeadAngle: state.headEatAngleScale }, 0, 0, 0, 0, 0]));
  add('wolf', { shake: clip(2, false, time => [{ lastShakeProgress: time, shakeProgress: time }, 0, 0, 0, 0, 0], { samplesPerSecond: 240 }) });
  for (const id of ['villager', 'wandering_trader']) add(id, { unhappy: age(0.45, { getHeadRollingTimeLeft: 1 }) }, { entityClass: 'net.minecraft.entity.passive.VillagerEntity' });
  // Yarn 1.16.5 calls spike extension getTailAngle and tail phase getSpikesExtension.
  const guardian = controllers.find(request => request.models.includes('minecraft:guardian'));
  for (const id of ['guardian', 'elder_guardian']) add(id, remapClips(guardian.clips, ([state]) => [{
    getTailAngle: state.spikesAnimation, getSpikesExtension: state.tailAnimation,
  }, 0, 0, state.ageInTicks, 0, 0]), { layer: 'animated' });
  for (const id of ['enchanting_table', 'lectern']) add(id, {
    ...transitions((open, time) => [time * 20, 0.1, 0.9, open]),
    idle: clip(5 * Math.PI, true, time => [(time + 0.5) * 20, 0.1, 0.9, 1]),
  }, { method: 'setPageAngles' });
  add('dragon_skull', { jaw: clip(0.5, true, time => [time * 20, 0, 0]) }, { method: 'method_2821' });

  for (const request of [...requests]) for (const layer of Object.keys(inventory[request.model])) {
    if (request.layer || ['main', 'animated'].includes(layer) || !inventory[request.model][layer].length) continue;
    requests.push({ ...request, layer, class: undefined, clips: Object.fromEntries(Object.entries(request.clips)
      .map(([name, animation]) => [`${name}_${layer}`, animation])) });
  }
  for (const request of requests) if (!request.layer && inventory[request.model].animated) request.layer = 'animated';
  return requests;
}
