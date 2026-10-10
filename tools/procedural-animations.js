import { blockAnimations } from './procedural-blocks.js';
import { entityAnimations } from './procedural-entities.js';
import { humanoidAnimations } from './procedural-humanoids.js';
import { classicAnimations } from './procedural-classic.js';
import { extractionAdapter } from './extraction-adapters.js';

export function proceduralAnimations(version, records) {
  // Model methods, state fields, and controller timings are reviewed per release.
  const { procedural, proceduralRequests } = extractionAdapter(version);
  if (!procedural) return [];
  if (procedural === 'classic') return classicAnimations(version, records);
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
  return proceduralRequests(requests);
}
