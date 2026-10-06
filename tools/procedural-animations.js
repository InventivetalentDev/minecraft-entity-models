import { blockAnimations } from './procedural-blocks.js';
import { entityAnimations } from './procedural-entities.js';
import { humanoidAnimations } from './procedural-humanoids.js';

export function proceduralAnimations(version, records) {
  // Model methods, state fields, and controller timings are reviewed against this release.
  if (version !== '1.21.11') return [];
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
  return requests;
}
