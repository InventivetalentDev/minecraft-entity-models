const MODEL = 'net.minecraft.client.model.';

const NATIVE_MODELS = {
  ArmadilloAnimation: 'armadillo',
  BabyArmadilloAnimation: 'armadillo_baby',
  BabyAxolotlAnimation: 'axolotl_baby',
  BabyRabbitAnimation: 'rabbit_baby',
  CamelAnimation: 'camel',
  CamelBabyAnimation: 'camel_baby',
  FoxBabyAnimation: 'fox_baby',
  RabbitAnimation: 'rabbit',
};

const ADULT_MODELS = {
  'animal.axolotl.AxolotlModel': 'animal.axolotl.AdultAxolotlModel',
  'animal.bee.BeeModel': 'animal.bee.AdultBeeModel',
  'animal.chicken.ChickenModel': 'animal.chicken.AdultChickenModel',
  'animal.feline.CatModel': 'animal.feline.AdultCatModel',
  'animal.feline.OcelotModel': 'animal.feline.AdultOcelotModel',
  'animal.fox.FoxModel': 'animal.fox.AdultFoxModel',
  'animal.turtle.TurtleModel': 'animal.turtle.AdultTurtleModel',
  'animal.wolf.WolfModel': 'animal.wolf.AdultWolfModel',
  'monster.piglin.PiglinModel': 'monster.piglin.AdultPiglinModel',
  'monster.piglin.ZombifiedPiglinModel': 'monster.piglin.AdultZombifiedPiglinModel',
  'monster.strider.StriderModel': 'monster.strider.AdultStriderModel',
};

const BABY_MODELS = {
  'animal.bee.BeeModel': 'animal.bee.BabyBeeModel',
  'animal.chicken.ChickenModel': 'animal.chicken.BabyChickenModel',
  'animal.cow.CowModel': 'animal.cow.BabyCowModel',
  'animal.cow.ColdCowModel': 'animal.cow.BabyCowModel',
  'animal.cow.WarmCowModel': 'animal.cow.BabyCowModel',
  'animal.dolphin.DolphinModel': 'animal.dolphin.BabyDolphinModel',
  'animal.equine.DonkeyModel': 'animal.equine.BabyDonkeyModel',
  'animal.equine.HorseModel': 'animal.equine.BabyHorseModel',
  'animal.feline.CatModel': 'animal.feline.BabyCatModel',
  'animal.feline.OcelotModel': 'animal.feline.BabyOcelotModel',
  'animal.goat.GoatModel': 'animal.goat.BabyGoatModel',
  'animal.llama.LlamaModel': 'animal.llama.BabyLlamaModel',
  'animal.panda.PandaModel': 'animal.panda.BabyPandaModel',
  'animal.pig.PigModel': 'animal.pig.BabyPigModel',
  'animal.polarbear.PolarBearModel': 'animal.polarbear.BabyPolarBearModel',
  'animal.sheep.SheepModel': 'animal.sheep.BabySheepModel',
  'animal.squid.SquidModel': 'animal.squid.BabySquidModel',
  'animal.turtle.TurtleModel': 'animal.turtle.BabyTurtleModel',
  'animal.wolf.WolfModel': 'animal.wolf.BabyWolfModel',
  'monster.hoglin.HoglinModel': 'monster.hoglin.BabyHoglinModel',
  'monster.piglin.PiglinModel': 'monster.piglin.BabyPiglinModel',
  'monster.piglin.ZombifiedPiglinModel': 'monster.piglin.BabyZombifiedPiglinModel',
  'monster.strider.StriderModel': 'monster.strider.BabyStriderModel',
  'monster.zombie.DrownedModel': 'monster.zombie.BabyDrownedModel',
  'monster.zombie.ZombieModel': 'monster.zombie.BabyZombieModel',
  'monster.zombie.ZombieVillagerModel': 'monster.zombie.BabyZombieVillagerModel',
  'npc.VillagerModel': 'npc.BabyVillagerModel',
};

export function normalizeAnimationRoots26(records) {
  const layer = records.find(model => model.id === 'minecraft:axolotl_baby')?.layers.main;
  if (!layer) return;
  const root = layer.root;
  // Vanilla's part lookup lets the named child replace the outer root. Give that
  // child a unique animation target while retaining both parts and their poses.
  if (!root.children.root || root.children.animation_root) {
    throw new Error('Unexpected 26.1.2 baby axolotl animation root');
  }
  root.children.animation_root = root.children.root;
  delete root.children.root;
}

export function nativeAnimations26(dump) {
  // Adult and baby constructors can accept both layers; the renderer selects these separate definitions.
  return dump.map(entry => {
    if (!NATIVE_MODELS[entry.class]) return entry;
    const animations = entry.class === 'BabyAxolotlAnimation'
      ? Object.fromEntries(Object.entries(entry.animations).map(([name, animation]) => [name, {
        ...animation, bones: Object.fromEntries(Object.entries(animation.bones).map(([bone, channels]) =>
          [bone === 'root' ? 'animation_root' : bone, channels])),
      }])) : entry.animations;
    return { ...entry, animations, modelIds: [`minecraft:${NATIVE_MODELS[entry.class]}`] };
  });
}

function bookStates(values) {
  return values.map(state => ({ $factory: {
    method: 'forAnimation', parameters: ['float', 'float', 'float', 'float'],
    values: [state.animationPos, state.pageFlip1, state.pageFlip2, state.open],
  } }));
}

export function proceduralAnimations26(requests) {
  return requests.flatMap(request => {
    if (!request.class.startsWith(MODEL)) return [request];
    // These models use native keyframe definitions in 26.1.2 instead of the earlier procedural methods.
    if (request.class === MODEL + 'animal.rabbit.RabbitModel') return [];
    const className = request.class.slice(MODEL.length);
    const groups = new Map();
    for (const id of request.models) {
      if (id === 'minecraft:axolotl_baby' || id === 'minecraft:fox_baby') continue;
      const type = id.includes('_baby') && BABY_MODELS[className] || ADULT_MODELS[className] || className;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(id);
    }
    const clips = className === 'object.book.BookModel' ? Object.fromEntries(Object.entries(request.clips).map(([name, clip]) => [name,
      { ...clip, frames: clip.frames.map(frame => ({ ...frame, values: bookStates(frame.values),
        ...(frame.pre ? { pre: bookStates(frame.pre) } : {}) })) },
    ])) : request.clips;
    const parameters = className === 'animal.feline.CatModel'
      ? ['net.minecraft.client.renderer.entity.state.FelineRenderState'] : request.parameters;
    return [...groups].map(([type, models]) => ({ ...request, class: MODEL + type, models, parameters, clips }));
  });
}
