import { clip, countdown, remapClips, steppedClip, squidTentacleAngle } from './procedural-sampling.js';
import { classicBlockAnimations } from './procedural-classic-blocks.js';
import { entityAnimations } from './procedural-entities.js';

const MODEL = 'net.minecraft.client.model.';
const ENTITY = 'net.minecraft.world.entity.';
const FLOATS = Array(5).fill('float');
const f = Math.fround;
const TAU = 2 * Math.PI;
const period = frequency => TAU / f(frequency) / 20;
const constant = $static => ({ $static });
const emptyItem = constant('net.minecraft.world.item.ItemStack.EMPTY');
const vector = (x = 0, y = 0, z = 0) => ({ $constructor: { parameters: ['double', 'double', 'double'], values: [x, y, z] } });
const entity = (type, getters, fields) => ({ $entity: ENTITY + type, getters, ...(fields ? { fields } : {}) });
const args = (subject = null, phase = 0, speed = 0, age = 0, yaw = 0, pitch = 0) => [subject, phase, speed, age, yaw, pitch];
const stationary = { getFallFlyingTicks: 0, isVisuallySwimming: false, isUsingItem: false,
  getMainArm: 'RIGHT', getUsedItemHand: 'MAIN_HAND', isCrouching: false,
  getDeltaMovement: vector(), 'getItemBySlot(net.minecraft.world.entity.EquipmentSlot)': emptyItem };

// These signatures and getter inputs follow the mapped 1.17.1 and 1.20.1 model methods.
// Entity fixtures describe a preview state; they do not advance gameplay or select equipment.
export function classicAnimations(version, records) {
  if (!['1.17.1', '1.20.1'].includes(version)) return [];
  const layers = new Map(records.map(record => [record.id, record.layers]));
  const requests = classicBlockAnimations([...layers.keys()]);
  const ground = version === '1.17.1' ? 'isOnGround' : 'onGround';
  function add(model, ids, clips, options = {}) {
    const models = ids.map(id => `minecraft:${id}`).filter(id => layers.has(id));
    if (!models.length) return;
    const request = { class: MODEL + model, models, method: 'setupAnim', parameters: [ENTITY + 'Entity', ...FLOATS],
      resetModel: true, fields: { young: false, riding: false, attackTime: 0 }, clips, ...options };
    requests.push(request);
    return request;
  }
  const cycle = (frequency, subject = null, samplesPerSecond = 240) =>
    clip(period(frequency), true, time => args(subject, 0, 0, time * 20), { samplesPerSecond });
  const walk = (subject = null, frequency = 0.6662, loop = true) => {
    const length = period(frequency);
    const values = time => args(subject, time * 20, 1);
    const result = clip(length, loop, values, { samplesPerSecond: 240 });
    for (const fraction of [0.25, 0.5, 0.75]) {
      const time = length * fraction;
      result.frames = result.frames.filter(frame => Math.abs(frame.time - time) > 1e-10);
      result.frames.push({ time, values: values(time) });
    }
    result.frames.sort((a, b) => a.time - b.time);
    return result;
  };
  const prepare = (parameters = [ENTITY + 'Entity', 'float', 'float', 'float']) =>
    ({ prepare: { method: 'prepareMobModel', parameters, arguments: [0, 1, 2, { value: 0 }] } });

  for (const [model, ids] of [['CowModel', ['cow', 'mooshroom']], ['PigModel', ['pig']],
    ['CreeperModel', ['creeper']], ['SpiderModel', ['spider', 'cave_spider']]]) {
    add(model, ids, { walk_cycle: walk() });
  }
  add('ChickenModel', ['chicken'], { walk_cycle: walk(),
    fly: clip(period(1.8), true, time => args(null, 0, 0, Math.sin(time * 20 * f(1.8)) + 1), { samplesPerSecond: 480 }) });
  for (const [model, id, frequency] of [['EndermiteModel', 'endermite', 0.9], ['SilverfishModel', 'silverfish', 0.9],
    ['GhastModel', 'ghast', 0.3], ['PufferfishBigModel', 'pufferfish_big', 0.2],
    ['PufferfishMidModel', 'pufferfish_medium', 0.2], ['PufferfishSmallModel', 'pufferfish_small', 0.2]]) {
    add(model, [id], { [id.startsWith('pufferfish') ? 'swim' : 'idle']: cycle(frequency, null, 360) });
  }
  const inWater = entity('animal.Cod', { isInWater: true });
  for (const [model, id] of [['CodModel', 'cod'], ['SalmonModel', 'salmon'],
    ['TropicalFishModelA', 'tropical_fish_small'], ['TropicalFishModelB', 'tropical_fish_large']]) {
    add(model, [id], { swim: cycle(0.6, inWater) });
  }
  add('TadpoleModel', ['tadpole'], { swim: cycle(0.3, entity('animal.frog.Tadpole', { isInWater: true })) });
  add('DolphinModel', ['dolphin'], { swim: cycle(0.3, entity('animal.Dolphin', { getDeltaMovement: vector(0.1) })) });
  // Axolotl stores the preceding render's rotations. These five-second samples retain that
  // history at 120 samples per second and start each action with an empty rotation cache.
  add('AxolotlModel', ['axolotl'], Object.fromEntries([
    ['swim', true, true], ['hover', true, false], ['crawl', false, true], ['idle', false, false],
  ].map(([name, water, moving]) => [`${name}_sample`, clip(5, false, time => args(entity('animal.axolotl.Axolotl', {
    isPlayingDead: false, isInWaterOrBubble: water, [ground]: !water, getDeltaMovement: vector(moving ? 0.1 : 0),
    getXRot: 0, getYRot: 0, getModelRotationValues: { $new: 'java.util.HashMap' },
  }, { position: vector(), xRotO: 0, yRotO: 0, xOld: 0, zOld: 0 }), 0, 0, time * 20))])), { continuous: true });
  add('SquidModel', ['squid', 'glow_squid'], { swim_cycle: clip(1.6, true, time => {
    const tick = Math.floor(time * 20), partial = time * 20 - tick;
    return args(null, 0, 0, squidTentacleAngle(tick) + (squidTentacleAngle(tick + 1) - squidTentacleAngle(tick)) * partial);
  }, { samplesPerSecond: 240 }) });
  add('StriderModel', ['strider'], { idle: cycle(0.2, entity('monster.Strider', { isVehicle: false })) });
  add('PhantomModel', ['phantom'], { fly: cycle(f(7.448451) * f(0.017453292),
    entity('monster.Phantom', { getUniqueFlapTickOffset: 0 })) });
  add('BeeModel', ['bee'], {
    fly: cycle(0.06, entity('animal.Bee', { [ground]: false, getDeltaMovement: vector(), isAngry: false }), 360),
    fly_angry: cycle(f(120.32113) * f(0.017453292), entity('animal.Bee', { [ground]: false, getDeltaMovement: vector(), isAngry: true }), 360),
  });
  const parrotValues = (pose, time, tick = Math.floor(time * 20)) => [pose, tick, 0, 0,
    pose === 'FLYING' ? Math.sin(time * 20 * f(1.8)) + 1 : 0, 0, 0];
  add('ParrotModel', ['parrot'], {
    dance_sample: steppedClip(40, tick => parrotValues('PARTY', tick / 20, tick)),
    fly: clip(period(1.8), true, time => parrotValues('FLYING', time), { samplesPerSecond: 480 }),
  }, { parameters: [MODEL + 'ParrotModel$State', 'int', ...FLOATS],
    prepare: { method: 'prepare', parameters: [MODEL + 'ParrotModel$State'], arguments: [0] } });
  add('GoatModel', ['goat'], { walk_cycle: walk(entity('animal.goat.Goat', {
    isBaby: false, getRammingXHeadRot: 0, ...(version === '1.20.1' ? { hasLeftHorn: true, hasRightHorn: true } : {}),
  })) });
  add('LlamaModel', ['llama', 'trader_llama'], { walk_cycle: walk(entity('animal.horse.Llama', { hasChest: false, isBaby: false })) });
  add('PandaModel', ['panda'], { walk_cycle: walk(entity('animal.Panda', {
    getUnhappyCounter: 0, getSneezeCounter: 0, isSneezing: false, isEating: false, isScared: false,
  })) });
  add('PolarBearModel', ['polar_bear'], { walk_cycle: walk(entity('animal.PolarBear', { 'getStandingAnimationScale(float)': 0 })) });
  add('FoxModel', ['fox'], { walk_cycle: walk(entity('animal.Fox', {
    isCrouching: false, isFaceplanted: false, isSleeping: false, isSitting: false, 'getHeadRollAngle(float)': 0, 'getCrouchAmount(float)': 0,
  })) }, prepare());
  add('WolfModel', ['wolf'], { walk_cycle: walk(entity('animal.Wolf', {
    isAngry: false, isInSittingPose: false, 'getHeadRollAngle(float)': 0, 'getBodyRollAngle(float,float)': 0,
  })) }, prepare());
  add('WolfModel', ['wolf'], { shake: clip(2, false, time => args(entity('animal.Wolf', {
    isAngry: false, isInSittingPose: false, 'getHeadRollAngle(float)': 0,
  }, { shakeAnimO: time, shakeAnim: time })), { samplesPerSecond: 240 }) }, prepare());
  add('HoglinModel', ['hoglin', 'zoglin'], { walk_cycle: walk(entity('monster.hoglin.Hoglin', { isBaby: false, getAttackAnimationRemainingTicks: 0 }), 1) });
  for (const [model, ids, type, extra] of [
    ['HorseModel', ['horse', 'skeleton_horse', 'zombie_horse', 'horse_armor'], 'Horse', {}],
    ['ChestedHorseModel', ['donkey', 'mule'], 'Donkey', { hasChest: false }],
  ]) add(model, ids, { walk_sample: walk(entity(`animal.horse.${type}`, {
    isSaddled: false, isVehicle: false, getXRot: 0, 'getEatAnim(float)': 0, 'getStandAnim(float)': 0,
    'getMouthAnim(float)': 0, isInWater: false, isBaby: false, ...extra,
  }), 0.6662, false) }, prepare());
  add('OcelotModel', ['ocelot'], { walk_sample: walk(null, 0.6662, false) });
  add('CatModel', ['cat'], { walk_sample: walk(null, 0.6662, false) });
  add('VillagerModel', ['villager', 'wandering_trader'], {
    walk_cycle: walk(), unhappy: cycle(0.45, entity('npc.Villager', { getUnhappyCounter: 1 })),
  });
  add('TurtleModel', ['turtle'], { swim_cycle: walk(entity('animal.Turtle', {
    isInWater: true, [ground]: false, isLayingEgg: false, hasEgg: false,
  }), f(0.6662) / 5) });
  add('RabbitModel', ['rabbit'], { jump: clip(0.5, false, time => args(entity('animal.Rabbit', { 'getJumpCompletion(float)': time * 2 }))) });
  add('EvokerFangsModel', ['evoker_fangs'], { bite: clip(1, false, time => args(null, time), { samplesPerSecond: 240 }) });
  add('IronGolemModel', ['iron_golem'], {
    walk_cycle: clip(0.65, true, time => args(entity('animal.IronGolem', { getAttackAnimationTick: 0, getOfferFlowerTick: 0 }), time * 20, 1)),
  }, prepare());
  add('RavagerModel', ['ravager'], { walk_cycle: walk(entity('monster.Ravager', { getStunnedTick: 0, getRoarTick: 0, getAttackTick: 0 })) }, prepare());

  const controllers = entityAnimations(['minecraft:sheep', 'minecraft:shulker', 'minecraft:guardian', 'minecraft:elder_guardian']);
  const guardian = controllers.find(request => request.models.includes('minecraft:guardian'));
  add('GuardianModel', ['guardian', 'elder_guardian'], remapClips(guardian.clips, ([state]) => args(entity('monster.Guardian', {
    'getSpikesAnimation(float)': state.spikesAnimation, 'getTailAnimation(float)': state.tailAnimation, hasActiveAttackTarget: false,
  }, { tickCount: Math.floor(state.ageInTicks) }), 0, 0, state.ageInTicks)), { cameraIndependent: true });
  const shulker = controllers.find(request => request.clips.open && request.models.includes('minecraft:shulker'));
  add('ShulkerModel', ['shulker'], remapClips(shulker.clips, ([state]) => args(entity('monster.Shulker', {
    'getClientPeekAmount(float)': state.peekAmount,
  }, { yHeadRot: 180, yBodyRot: 0, tickCount: Math.floor(state.ageInTicks) }), 0, 0, state.ageInTicks)));

  const wool = layers.get('minecraft:sheep')?.fur;
  for (const layer of ['main', ...(wool ? ['fur'] : [])]) {
    const subject = entity('animal.Sheep', { 'getHeadEatPositionScale(float)': 0, 'getHeadEatAngleScale(float)': 0 });
    add(layer === 'main' ? 'SheepModel' : 'SheepFurModel', ['sheep'], { [layer === 'main' ? 'walk_cycle' : 'walk_cycle_fur']: walk(subject) },
      { ...prepare(), ...(layer === 'main' ? {} : { layer }) });
    const eat = controllers.find(request => request.clips.eat && request.models.includes('minecraft:sheep'));
    add(layer === 'main' ? 'SheepModel' : 'SheepFurModel', ['sheep'], remapClips(eat.clips, ([state]) => args(entity('animal.Sheep', {
      'getHeadEatPositionScale(float)': state.headEatPositionScale, 'getHeadEatAngleScale(float)': state.headEatAngleScale,
    })), name => layer === 'main' ? name : `${name}_fur`), { ...prepare(), ...(layer === 'main' ? {} : { layer }) });
  }

  add('IronGolemModel', ['iron_golem'], {
    attack: countdown(10, (left, partial) => [entity('animal.IronGolem', { getAttackAnimationTick: left, getOfferFlowerTick: 0 }), 0, 0, partial]),
  }, { method: 'prepareMobModel', parameters: [ENTITY + 'Entity', 'float', 'float', 'float'] });
  add('RavagerModel', ['ravager'], Object.fromEntries([['attack', 10, 'getAttackTick'], ['stunned', 40, 'getStunnedTick'], ['roar', 20, 'getRoarTick']]
    .map(([name, ticks, getter]) => [name, countdown(ticks, (left, partial) => [entity('monster.Ravager', {
      getStunnedTick: 0, getRoarTick: 0, getAttackTick: 0, [getter]: left,
    }), 0, 0, partial])])), { method: 'prepareMobModel', parameters: [ENTITY + 'Entity', 'float', 'float', 'float'] });

  const baseHumanoid = type => entity(type, { ...stationary, isAggressive: false, getMainHandItem: emptyItem, isLeftHanded: false });
  for (const [model, ids, type] of [
    ['SkeletonModel', ['skeleton', 'stray', 'wither_skeleton'], 'monster.Skeleton'],
    ['ZombieModel', ['zombie', 'husk'], 'monster.Zombie'], ['DrownedModel', ['drowned'], 'monster.Zombie'],
    ['GiantZombieModel', ['giant'], 'monster.Giant'], ['ZombieVillagerModel', ['zombie_villager'], 'monster.Zombie'],
    ['EndermanModel', ['enderman'], 'monster.EnderMan'],
  ]) add(model, ids, { walk_cycle: walk(baseHumanoid(type)) });
  for (const slim of [false, true]) add('PlayerModel', [slim ? 'player_slim' : 'player'],
    { walk_cycle: walk(baseHumanoid('monster.Zombie')) }, { constructor: { parameters: ['boolean'], values: [slim] } });
  for (const [ids, type, armPose] of [[['piglin', 'piglin_brute'], 'monster.piglin.Piglin', true],
    [['zombified_piglin'], 'monster.ZombifiedPiglin', false]]) {
    const subject = baseHumanoid(type);
    subject.getters.getType = constant(`net.minecraft.world.entity.EntityType.${armPose ? 'PIGLIN' : 'ZOMBIFIED_PIGLIN'}`);
    if (armPose) subject.getters.getArmPose = 'DEFAULT';
    add('PiglinModel', ids, { walk_sample: walk(subject, 0.6662, false) });
  }
  add('IllagerModel', ['pillager', 'vindicator', 'evoker', 'illusioner'], {
    walk_cycle: walk(entity('monster.Pillager', { getArmPose: 'NEUTRAL' })),
  });
  for (const request of [...requests]) {
    const overlay = { CreeperModel: 'armor', CatModel: 'collar', DrownedModel: 'outer', SkeletonModel: 'outer',
      TropicalFishModelA: 'pattern', TropicalFishModelB: 'pattern' }[request.class.slice(MODEL.length)];
    const models = overlay && request.models.filter(id => layers.get(id)?.[overlay]);
    if (models?.length) requests.push({ ...request, models, layer: overlay,
      clips: Object.fromEntries(Object.entries(request.clips).map(([name, animation]) => [`${name}_${overlay}`, animation])) });
    if (!['SkeletonModel', 'ZombieModel', 'DrownedModel', 'GiantZombieModel', 'ZombieVillagerModel', 'PlayerModel', 'PiglinModel'].includes(request.class.slice(MODEL.length))) continue;
    for (const layer of ['inner_armor', 'outer_armor']) {
      const models = request.models.filter(id => layers.get(id)?.[layer]);
      if (!models.length) continue;
      requests.push({ ...request, class: MODEL + 'HumanoidModel', constructor: undefined, models, layer,
        clips: { [`walk_cycle_${layer}`]: walk(baseHumanoid('monster.Zombie')) } });
    }
  }
  for (const raft of [false, true]) {
    const ids = [...layers.keys()].filter(id => /^minecraft:(?:chest_)?boat\//.test(id) && id.endsWith('/bamboo') === raft);
    for (const chest of [false, true]) {
      const selected = ids.filter(id => id.includes(':chest_') === chest).map(id => id.slice(10));
      const rowing = (left, right) => clip(0.8, true, time => args(entity('vehicle.Boat', {
        'getRowingTime(int,float)': [left ? time * 20 * f(0.3926991) : 0, right ? time * 20 * f(0.3926991) : 0],
      })));
      add(`${chest ? 'Chest' : ''}${raft ? 'Raft' : 'Boat'}Model`, selected,
        { row: rowing(true, true), row_left: rowing(true, false), row_right: rowing(false, true) });
    }
  }
  return requests;
}
