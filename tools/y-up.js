import { readFile } from 'node:fs/promises';

// y-up.json lists the models that vanilla draws without negating Y, with the renderer evidence for each.
export async function applyYUp(records, ids) {
  ids ??= JSON.parse(await readFile(new URL('./y-up.json', import.meta.url), 'utf8'));
  for (const model of records) {
    if (Object.hasOwn(ids, model.id.replace(/^minecraft:/, ''))) model.yUp = true;
    else delete model.yUp;
  }
  return records;
}
