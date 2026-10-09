import { applyTransforms } from './transform.js';

// Older renderers share model layers and choose visible parts at draw time. These
// separate block models retain those choices without changing the registered layers.
export async function addClassicBlockModels(records, version) {
  if (!['1.17.1', '1.20.1'].includes(version)) return records;
  const additions = [];
  const byId = new Map(records.map(model => [model.id, model]));
  function add(id, source, children) {
    if (!source?.layers.main || byId.has(`minecraft:${id}`)) return;
    const layer = structuredClone(source.layers.main);
    if (children) layer.root.children = Object.fromEntries(children.map(name => {
      const part = layer.root.children[name];
      if (!part) throw new Error(`${source.id}: missing block part ${name}`);
      return [name, part];
    }));
    const model = { id: `minecraft:${id}`, layers: { main: layer } };
    additions.push(model);
    return model;
  }
  for (const source of records) {
    const sign = /^minecraft:sign\/([^/]+)$/.exec(source.id);
    if (sign) {
      add(`sign/standing/${sign[1]}`, source);
      add(`sign/wall/${sign[1]}`, source, ['sign']);
    }
    const hanging = /^minecraft:hanging_sign\/([^/]+)$/.exec(source.id);
    if (hanging) {
      // HangingSignModel.evaluateVisibleParts: the wall has a plank; an attached
      // ceiling sign uses the V-shaped chains instead of the two normal chains.
      add(`hanging_sign/${hanging[1]}/wall`, source, ['board', 'plank', 'normalChains']);
      add(`hanging_sign/${hanging[1]}/ceiling`, source, ['board', 'normalChains']);
      add(`hanging_sign/${hanging[1]}/ceiling_middle`, source, ['board', 'vChains']);
    }
  }
  const banner = byId.get('minecraft:banner');
  for (const [name, children] of [['standing_banner', ['pole', 'bar']], ['wall_banner', ['bar']]]) {
    const model = add(name, banner, children);
    if (!model) continue;
    const flag = structuredClone(banner.layers.main);
    flag.root.children = { flag: flag.root.children.flag };
    flag.root.children.flag.pose.offset[1] = -32;
    model.layers.flag = flag;
  }
  const shulker = add('shulker_box', byId.get('minecraft:shulker'), ['base', 'lid']);
  if (shulker) delete shulker.layers.main.render;
  await applyTransforms(additions, version);
  for (const model of additions) {
    // BannerRenderer uses different translations from the later split models.
    if (model.id === 'minecraft:standing_banner') model.transform = structuredClone(banner.transform);
    if (model.id === 'minecraft:wall_banner') model.transform = [
      { translate: [8, -2.6666667, 8] }, { translate: [0, -5, -7] }, { scale: [0.6666667, -0.6666667, -0.6666667] },
    ];
  }
  records.push(...additions);
  return records;
}
