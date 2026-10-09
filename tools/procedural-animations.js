import { blockAnimations } from './procedural-blocks.js';
import { entityAnimations } from './procedural-entities.js';
import { humanoidAnimations } from './procedural-humanoids.js';
import { classicAnimations } from './procedural-classic.js';
import { proceduralAnimations26 } from './animations-26.js';

export function proceduralAnimations(version, records) {
  if (['1.17.1', '1.20.1'].includes(version)) return classicAnimations(version, records);
  // Model methods, state fields, and controller timings are reviewed per release.
  if (!['1.21.11', '26.1.2'].includes(version)) return [];
  const ids = records.map(record => record.id);
  const entities = entityAnimations(ids);
  const requests = [...blockAnimations(ids), ...entities, ...humanoidAnimations(ids, records)];
  // Wool has its own baked pose and model method, so each layer receives its own deltas.
  for (const request of entities) {
    if (request.class !== 'net.minecraft.client.model.animal.sheep.SheepModel') continue;
    for (const id of request.models) {
      for (const layer of ['wool', 'wool_undercoat']) {
        if (!records.find(record => record.id === id)?.layers?.[layer]) continue;
        requests.push({ ...request, class: 'net.minecraft.client.model.animal.sheep.SheepFurModel', models: [id], layer,
          clips: Object.fromEntries(Object.entries(request.clips).map(([name, clip]) => [`${name}_${layer}`, clip])) });
      }
    }
  }
  return version === '26.1.2' ? proceduralAnimations26(requests) : requests;
}
