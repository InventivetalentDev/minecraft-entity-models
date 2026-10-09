const RENAMED_26 = {
  'banner_base': 'banner/banner_base',
  'enchanting_table_book': 'enchantment/enchanting_table_book',
  'minecart': 'minecart/minecart',
  'phantom_eyes': 'phantom/phantom_eyes',
  'spider_eyes': 'spider/spider_eyes',
  'cat/black': 'cat/cat_black',
  'cow/red_mooshroom': 'cow/mooshroom_red',
  'llama/creamy': 'llama/llama_creamy',
  'rabbit/brown': 'rabbit/rabbit_brown',
  'turtle/big_sea_turtle': 'turtle/turtle',
};

export function versionTexture(texture, version, baby = false, textureEntries = new Set()) {
  if (version !== '26.1.2' || !texture) return texture;
  const name = /^minecraft:textures\/entity\/(.+)\.png$/.exec(texture)?.[1];
  if (RENAMED_26[name]) texture = `minecraft:textures/entity/${RENAMED_26[name]}.png`;
  if (baby) {
    const candidate = texture === 'minecraft:textures/entity/sniffer/sniffer.png'
      ? 'minecraft:textures/entity/sniffer/snifflet.png' : texture.replace(/\.png$/, '_baby.png');
    if (textureEntries.has(candidate)) return candidate;
  }
  return texture;
}
