import { validatePasses } from './passes.js';

// Feature renderer names and textures are from the 1.16.5 Yarn runtime.
const PASSES = {
  spider: [{ layer: 'main', textureLocation: 'spider_eyes', render: 'eyes' }],
  cave_spider: [{ layer: 'main', textureLocation: 'spider_eyes', render: 'eyes' }],
  enderman: [{ layer: 'main', textureLocation: 'enderman/enderman_eyes', render: 'eyes' }],
  phantom: [{ layer: 'main', textureLocation: 'phantom_eyes', render: 'eyes' }],
  ender_dragon: [{ layer: 'main', textureLocation: 'enderdragon/dragon_eyes', render: 'eyes' }],
  creeper: [{ layer: 'armor', textureLocation: 'creeper/creeper_armor', render: 'energy_swirl', when: 'powered' }],
  wither: [{ layer: 'armor', textureLocation: 'wither/wither_armor', render: 'energy_swirl', when: 'powered' }],
  slime: [{ layer: 'outer', textureLocation: 'slime/slime', render: 'translucent' }],
  drowned: [{ layer: 'outer', textureLocation: 'zombie/drowned_outer_layer' }],
  stray: [{ layer: 'outer', textureLocation: 'skeleton/stray_overlay' }],
  sheep: [{ layer: 'fur', textureLocation: 'sheep/sheep_fur', when: 'not_sheared', tint: 'wool_color' }],
  cat: [{ layer: 'collar', textureLocation: 'cat/cat_collar', when: 'tamed', tint: 'collar_color' }],
  wolf: [{ layer: 'main', textureLocation: 'wolf/wolf_collar', when: 'tamed', tint: 'collar_color' }],
};

const TEXTURES = {
  shulker_bullet: 'shulker/spark', armor_stand: 'armorstand/wood', llama_spit: 'llama/spit',
  polar_bear: 'bear/polarbear', magma_cube: 'slime/magmacube', leash_knot: 'lead_knot',
  elder_guardian: 'guardian_elder', iron_golem: 'iron_golem/iron_golem',
};

export function applyLegacyPasses(records) {
  for (const model of records) {
    const id = model.id.slice(10);
    if (TEXTURES[id]) model.layers.main.textureLocation = `minecraft:textures/entity/${TEXTURES[id]}.png`;
    if (['bed', 'bed_head', 'bed_foot', 'bell', 'banner', 'standing_banner', 'wall_banner', 'enchanting_table', 'lectern'].includes(id)) {
      for (const layer of Object.values(model.layers)) layer.render = 'solid';
    }
    if (['chest', 'trapped_chest', 'ender_chest', 'double_chest_left', 'double_chest_right'].includes(id)) {
      for (const layer of Object.values(model.layers)) layer.render = 'cutout_cull';
    }
    if (['shulker', 'skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'creeper_head', 'dragon_skull'].includes(id)) model.layers.main.render = 'cutout_z_offset';
    if (id === 'conduit') model.layers.shell.render = 'solid';
    if (id === 'trident') model.layers.main.render = 'solid';
    if (['player', 'player_slim', 'piglin', 'piglin_brute', 'zombified_piglin', 'wither_skull'].includes(id)) model.layers.main.render = 'translucent';
    const passes = [];
    for (const definition of PASSES[id] ?? []) {
      const layer = model.layers[definition.layer];
      if (!layer) throw new Error(`${model.id}: missing feature layer ${definition.layer}`);
      const pass = { ...definition, textureLocation: `minecraft:textures/entity/${definition.textureLocation}.png` };
      if (pass.layer !== 'main') {
        layer.textureLocation = pass.textureLocation;
        delete pass.textureLocation;
        if (pass.render) { layer.render = pass.render; delete pass.render; }
      }
      passes.push(pass);
    }
    if (passes.length) model.passes = passes;
    if (model.layers.animated) {
      if (model.layers.main.textureLocation) model.layers.animated.textureLocation = model.layers.main.textureLocation;
      if (model.layers.main.render) model.layers.animated.render = model.layers.main.render;
    }
    for (const name of ['single', 'shell']) if (model.layers[name] && model.layers.main.textureLocation)
      model.layers[name].textureLocation = model.layers.main.textureLocation;
    if (model.layers.saddle && ['pig', 'strider'].includes(id)) model.layers.saddle.textureLocation = `minecraft:textures/entity/${id}/${id}_saddle.png`;
    if (model.layers.armor && id === 'horse') delete model.layers.armor.textureLocation;
    if (model.layers.decor && id === 'trader_llama') model.layers.decor.textureLocation = 'minecraft:textures/entity/llama/decor/trader_llama.png';
    validatePasses(model);
  }
}
