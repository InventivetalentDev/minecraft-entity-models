import { clip } from './procedural-sampling.js';

const MODEL = 'net.minecraft.client.model.';
const STATE = 'net.minecraft.client.renderer.entity.state.';
const TAU = 2 * Math.PI;
const period = frequency => TAU / Math.fround(frequency) / 20;

// Frequencies and state inputs were checked against Minecraft 1.21.11 setupAnim methods.
export function entityAnimations(modelIds) {
  const available = new Set(modelIds);
  const requests = [];
  function add(model, ids, state, clips) {
    const models = ids.map(id => `minecraft:${id}`).filter(id => available.has(id));
    if (models.length) requests.push({ class: MODEL + model, models, method: 'setupAnim', parameters: [STATE + state], clips });
  }
  const cycle = (frequency, fields = {}, samplesPerSecond = 120) =>
    clip(period(frequency), true, time => [{ ...fields, ageInTicks: time * 20 }], { samplesPerSecond });

  for (const [model, ids, state, frequency] of [
    ['animal.fish.CodModel', ['cod'], 'LivingEntityRenderState', 0.6],
    ['animal.fish.SalmonModel', ['salmon', 'salmon_large', 'salmon_small'], 'SalmonRenderState', 0.6],
    ['animal.fish.TropicalFishLargeModel', ['tropical_fish_large'], 'TropicalFishRenderState', 0.6],
    ['animal.fish.TropicalFishSmallModel', ['tropical_fish_small'], 'TropicalFishRenderState', 0.6],
    ['animal.frog.TadpoleModel', ['tadpole'], 'LivingEntityRenderState', 0.3],
  ]) add(model, ids, state, { swim: cycle(frequency, { isInWater: true }) });
  for (const [size, id] of [['Big', 'big'], ['Mid', 'medium'], ['Small', 'small']]) {
    add(`animal.fish.Pufferfish${size}Model`, [`pufferfish_${id}`], 'EntityRenderState', { swim: cycle(0.2) });
  }
  add('animal.dolphin.DolphinModel', ['dolphin', 'dolphin_baby'], 'DolphinRenderState', {
    swim: cycle(0.3, { isMoving: true }),
  });
  add('animal.axolotl.AxolotlModel', ['axolotl', 'axolotl_baby'], 'AxolotlRenderState', {
    swim: cycle(0.033, { inWaterFactor: 1, movingFactor: 1 }),
    hover: cycle(0.075, { inWaterFactor: 1 }),
    crawl: cycle(0.11, { inWaterFactor: 0, onGroundFactor: 1, movingFactor: 1 }),
    idle: cycle(0.09, { inWaterFactor: 0, onGroundFactor: 1 }),
  });
  add('monster.guardian.GuardianModel', ['guardian', 'elder_guardian'], 'GuardianRenderState', {
    swim: clip(period(0.5), true, time => [{ ageInTicks: time * 20, tailAnimation: time * 10, spikesAnimation: 0 }]),
    idle: clip(period(0.125), true, time => [{ ageInTicks: time * 20, tailAnimation: time * 2.5, spikesAnimation: 1 }]),
  });
  // Squid speed is randomized. This preset fixes one tentacle cycle at 32 ticks and interpolates tick poses.
  const tentacle = tick => {
    const phase = tick * TAU / 32;
    return phase < Math.PI ? Math.sin(phase * phase / Math.PI) * Math.PI / 4 : 0;
  };
  add('animal.squid.SquidModel', ['squid', 'squid_baby', 'glow_squid', 'glow_squid_baby'], 'SquidRenderState', {
    swim_cycle: clip(32 / 20, true, time => {
      const ticks = time * 20;
      const tick = Math.floor(ticks);
      return [{ tentacleAngle: tentacle(tick) + (tentacle(tick + 1) - tentacle(tick)) * (ticks - tick) }];
    }, { samplesPerSecond: 240 }),
  });
  add('monster.endermite.EndermiteModel', ['endermite'], 'EntityRenderState', { idle: cycle(0.9, {}, 240) });
  add('monster.silverfish.SilverfishModel', ['silverfish'], 'EntityRenderState', { idle: cycle(0.9, {}, 360) });
  add('monster.ghast.GhastModel', ['ghast'], 'GhastRenderState', { idle: cycle(0.3) });
  add('animal.ghast.HappyGhastModel', ['happy_ghast', 'happy_ghast_baby'], 'HappyGhastRenderState', { idle: cycle(0.3) });
  add('monster.strider.StriderModel', ['strider', 'strider_baby'], 'StriderRenderState', { idle: cycle(0.2) });
  add('animal.parrot.ParrotModel', ['parrot'], 'ParrotRenderState', {
    dance: cycle(1, { pose: 'PARTY', flapAngle: 0 }, 360),
    fly: clip(period(1.8), true, time => [{ pose: 'FLYING', flapAngle: Math.sin(time * 20 * Math.fround(1.8)) + 1 }],
      { samplesPerSecond: 480 }),
  });
  add('animal.bee.BeeModel', ['bee', 'bee_baby'], 'BeeRenderState', {
    // Wing and body frequencies are 2.1 and 0.18 radians per tick, with a common period of 2pi / 0.06.
    fly: cycle(0.06, { hasStinger: true }, 360),
    fly_angry: cycle(Math.fround(120.32113) * Math.fround(0.017453292), { hasStinger: true, isAngry: true }, 360),
  });
  add('monster.phantom.PhantomModel', ['phantom'], 'PhantomRenderState', {
    fly: clip(period(Math.fround(7.448451) * Math.fround(0.017453292)), true, time => [{ flapTime: time * 20 }]),
  });
  add('object.projectile.WindChargeModel', ['wind_charge'], 'EntityRenderState', {
    spin: clip(22.5 / 20, true, time => [{ ageInTicks: time * 20 }]),
  });

  // walk_cycle fixes speed at 1 and advances walkAnimationPos by 1 per tick; vanilla derives both from movement.
  const walk = fields => {
    const length = period(0.6662);
    const values = time => [{ ...fields, walkAnimationSpeed: 1, walkAnimationPos: time * 20 }];
    const animation = clip(length, true, values, { samplesPerSecond: 240 });
    // Spider leg angles use abs(sin); include each corner of that curve between the regular samples.
    for (const fraction of [0.25, 0.5, 0.75]) {
      const time = length * fraction;
      animation.frames = animation.frames.filter(frame => Math.abs(frame.time - time) > 1e-10);
      animation.frames.push({ time, values: values(time) });
    }
    animation.frames.sort((a, b) => a.time - b.time);
    return animation;
  };
  for (const [model, ids, state, fields] of [
    ['animal.cow.CowModel', ['cow', 'cow_baby', 'mooshroom', 'mooshroom_baby'], 'LivingEntityRenderState'],
    ['animal.cow.ColdCowModel', ['cold_cow', 'cold_cow_baby'], 'LivingEntityRenderState'],
    ['animal.cow.WarmCowModel', ['warm_cow', 'warm_cow_baby'], 'LivingEntityRenderState'],
    ['animal.pig.PigModel', ['pig', 'pig_baby'], 'LivingEntityRenderState'],
    ['animal.pig.ColdPigModel', ['cold_pig', 'cold_pig_baby'], 'LivingEntityRenderState'],
    ['animal.sheep.SheepModel', ['sheep', 'sheep_baby'], 'SheepRenderState'],
    ['animal.goat.GoatModel', ['goat', 'goat_baby'], 'GoatRenderState', { hasLeftHorn: true, hasRightHorn: true }],
    ['animal.llama.LlamaModel', ['llama', 'llama_baby', 'trader_llama', 'trader_llama_baby'], 'LlamaRenderState'],
    ['monster.creeper.CreeperModel', ['creeper'], 'CreeperRenderState'],
    ['monster.spider.SpiderModel', ['spider', 'cave_spider'], 'LivingEntityRenderState'],
    ['animal.fox.FoxModel', ['fox', 'fox_baby'], 'FoxRenderState'],
    ['animal.panda.PandaModel', ['panda', 'panda_baby'], 'PandaRenderState'],
    ['animal.polarbear.PolarBearModel', ['polar_bear', 'polar_bear_baby'], 'PolarBearRenderState'],
  ]) add(model, ids, state, { walk_cycle: walk(fields) });
  add('animal.wolf.WolfModel', ['wolf', 'wolf_baby', 'wolf_armor', 'wolf_baby_armor'], 'WolfRenderState', {
    walk_cycle: walk(),
    shake: clip(2, false, time => [{ shakeAnim: time }], { samplesPerSecond: 240 }),
  });
  for (const [model, ids] of [
    ['animal.chicken.ChickenModel', ['chicken', 'chicken_baby']],
    ['animal.chicken.ColdChickenModel', ['cold_chicken', 'cold_chicken_baby']],
  ]) add(model, ids, 'ChickenRenderState', {
    walk_cycle: walk(),
    // Chicken and parrot flap phases advance by 1.8 radians per tick during steady flight.
    fly: clip(period(1.8), true, time => [{ flap: time * 20 * Math.fround(1.8), flapSpeed: 1 }], { samplesPerSecond: 480 }),
  });
  add('monster.hoglin.HoglinModel', ['hoglin', 'hoglin_baby', 'zoglin', 'zoglin_baby'], 'HoglinRenderState', {
    walk_cycle: clip(period(1), true, time => [{ walkAnimationSpeed: 1, walkAnimationPos: time * 20 }], { samplesPerSecond: 360 }),
  });
  // Equine and feline models use different frequencies for the same walk phase, so these previews do not loop.
  const walkSample = (fields = {}) => clip(period(0.6662), false, time => [{ ...fields, walkAnimationSpeed: 1, walkAnimationPos: time * 20 }],
    { samplesPerSecond: 240 });
  for (const [model, ids, state] of [
    ['animal.equine.HorseModel', ['horse', 'horse_baby', 'skeleton_horse', 'skeleton_horse_baby', 'zombie_horse', 'zombie_horse_baby',
      'horse_armor', 'horse_armor_baby', 'undead_horse_armor', 'undead_horse_baby_armor'], 'EquineRenderState'],
    ['animal.equine.DonkeyModel', ['donkey', 'donkey_baby', 'mule', 'mule_baby'], 'DonkeyRenderState'],
    ['animal.feline.CatModel', ['cat', 'cat_baby'], 'FelineRenderState'],
    ['animal.feline.OcelotModel', ['ocelot', 'ocelot_baby'], 'FelineRenderState'],
  ]) {
    if (model.startsWith('animal.equine.')) {
      // Equine tail offsets depend on ageScale even when the baby geometry is already baked.
      for (const baby of [false, true]) add(model, ids.filter(id => id.includes('baby') === baby), state,
        { walk_sample: walkSample({ isBaby: baby, ageScale: baby ? 0.5 : 1 }) });
    } else add(model, ids, state, { walk_sample: walkSample() });
  }
  add('npc.VillagerModel', ['villager', 'villager_baby', 'villager_no_hat', 'villager_baby_no_hat', 'wandering_trader'],
    'VillagerRenderState', { walk_cycle: walk(), unhappy: cycle(0.45, { isUnhappy: true }) });
  for (const baby of [false, true]) {
    // Sheep's eat timer lasts 40 ticks; its renderer interpolates within each tick before posing the head.
    const state = time => {
      const ticks = time * 20;
      const tick = Math.max(0, 40 - Math.floor(ticks));
      const partial = ticks - Math.floor(ticks);
      const headEatPositionScale = tick <= 0 ? 0 : tick >= 4 && tick <= 36 ? 1 : tick < 4 ? (tick - partial) / 4 : -(tick - 40 - partial) / 4;
      const headEatAngleScale = tick > 4 && tick <= 36 ? 0.62831855 + 0.21991149 * Math.sin((tick - 4 - partial) / 32 * 28.7) : tick > 0 ? 0.62831855 : 0;
      return [{ headEatPositionScale, headEatAngleScale, ageScale: baby ? 0.5 : 1 }];
    };
    const eat = clip(2, false, state, { samplesPerSecond: 240 });
    for (const [time, position] of [[0.2, 1], [1.85, 1], [2, 0]]) {
      eat.frames.find(frame => frame.time === time).pre = [{
        headEatPositionScale: position, headEatAngleScale: 0.62831855, ageScale: baby ? 0.5 : 1,
      }];
    }
    add('animal.sheep.SheepModel', [baby ? 'sheep_baby' : 'sheep'], 'SheepRenderState', { eat });
  }
  add('animal.turtle.TurtleModel', ['turtle', 'turtle_baby'], 'TurtleRenderState', {
    swim_cycle: clip(period(Math.fround(0.6662) / 5), true, time => [{
      isInWater: true, walkAnimationSpeed: 1, walkAnimationPos: time * 20,
    }], { samplesPerSecond: 240 }),
  });

  // AbstractBoat advances each active paddle by pi / 8 per tick; inactive paddles use phase zero.
  const row = (left, right) => clip(0.8, true, time => [{
    rowingTimeLeft: left ? time * 20 * Math.fround(0.3926991) : 0,
    rowingTimeRight: right ? time * 20 * Math.fround(0.3926991) : 0,
  }]);
  for (const raft of [false, true]) {
    const ids = [...available].filter(id => /^minecraft:(?:chest_)?boat\//.test(id) && id.endsWith('/bamboo') === raft)
      .map(id => id.slice('minecraft:'.length));
    add(`object.boat.${raft ? 'Raft' : 'Boat'}Model`, ids, 'BoatRenderState', {
      row: row(true, true), row_left: row(true, false), row_right: row(false, true),
    });
  }

  // Rabbit.startJumping sets 10 ticks; EvokerFangs.getAnimationProgress advances over 20 ticks.
  add('animal.rabbit.RabbitModel', ['rabbit', 'rabbit_baby'], 'RabbitRenderState', {
    jump: clip(0.5, false, time => [{ jumpCompletion: time * 2 }]),
  });
  add('effects.EvokerFangsModel', ['evoker_fangs'], 'EvokerFangsRenderState', {
    bite: clip(1, false, time => [{ biteProgress: time }], { samplesPerSecond: 240 }),
  });
  add('animal.golem.IronGolemModel', ['iron_golem'], 'IronGolemRenderState', {
    attack: clip(0.5, false, time => [{ attackTicksRemaining: Math.max(0.000001, 10 - time * 20) }], { end: [{}] }),
    walk_cycle: clip(13 / 20, true, time => [{ walkAnimationSpeed: 1, walkAnimationPos: time * 20 }]),
  });
  const ravagerAttack = clip(0.5, false, time => [{ attackTicksRemaining: Math.max(0.000001, 10 - time * 20) }],
    { samplesPerSecond: 480, end: [{}] });
  ravagerAttack.frames.find(frame => frame.time === 0.25).pre = [{ attackTicksRemaining: 5.000001 }];
  add('monster.ravager.RavagerModel', ['ravager'], 'RavagerRenderState', {
    attack: ravagerAttack,
    stunned: clip(2, false, time => [{ stunnedTicksRemaining: Math.max(0.000001, 40 - time * 20) }], { end: [{}] }),
    roar: clip(1, false, time => [{ roarAnimation: Math.max(0.000001, time) }], { end: [{}] }),
    walk_cycle: walk(),
  });

  const shulkerState = (peekAmount, ageInTicks) => [{ peekAmount, ageInTicks, yHeadRot: 180 }];
  function shulkerTransition(opening) {
    const state = time => shulkerState(opening ? time : 1 - time, time * 20);
    const animation = clip(1, false, state, { samplesPerSecond: 240 });
    // The lid's twist and bob start at strict peek thresholds; pre preserves their pose jumps.
    for (const peek of [0.3, 0.5]) {
      const time = opening ? peek : 1 - peek;
      const before = Math.fround(peek);
      const after = Math.fround(peek + 0.0000001);
      const frame = { time, pre: shulkerState(opening ? before : after, time * 20),
        values: shulkerState(opening ? after : before, time * 20) };
      animation.frames = animation.frames.filter(sample => Math.abs(sample.time - time) > 1e-10);
      animation.frames.push(frame);
    }
    animation.frames.sort((a, b) => a.time - b.time);
    return animation;
  }
  add('monster.shulker.ShulkerModel', ['shulker'], 'ShulkerRenderState', {
    open: shulkerTransition(true),
    close: shulkerTransition(false),
    open_idle: clip(period(0.1), true, time => shulkerState(1, 20 + time * 20)),
  });
  return requests;
}
