import { readFile } from 'node:fs/promises';

// LivingEntityRenderer: setupRotations (180 - bodyRot around Y), scale(-1, -1, 1), scale(state), translate(0, -1.501, 0).
const LIVING_HEAD = [{ rotate: [0, 3.1415927, 0] }, { scale: [-1, -1, 1] }];
const LIVING_TAIL = [{ translate: [0, -24.016, 0] }];

function before(version, limit) {
  const a = version.split('.').map(Number), b = limit.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0);
  }
  return false;
}

function find(entries, name, version) {
  const pick = key => [entries[key]].flat().find(entry => !entry.before || before(version, entry.before));
  if (Object.hasOwn(entries, name) && pick(name)) return pick(name);
  const key = Object.keys(entries).filter(key => key.includes('*') && pick(key) &&
    new RegExp(`^${key.split('*').map(text => text.replace(/[.\\+?^${}()|[\]]/g, '\\$&')).join('.*')}$`).test(name))
    .sort((a, b) => b.length - a.length)[0];
  return key && pick(key);
}

export function validateTransform(transform) {
  if (!Array.isArray(transform)) throw new Error('Expected transform array');
  for (const op of transform) {
    const keys = op && typeof op === 'object' && !Array.isArray(op) ? Object.keys(op) : [];
    if (keys.length !== 1 || !['rotate', 'scale', 'translate'].includes(keys[0]) || !Array.isArray(op[keys[0]]) ||
        op[keys[0]].length !== 3 || !op[keys[0]].every(Number.isFinite)) {
      throw new Error('Expected transform ops with one of rotate, scale, translate and 3 finite numbers');
    }
    if (op[keys[0]].every(number => number === (keys[0] === 'scale' ? 1 : 0))) throw new Error('Omit identity transform ops');
  }
}

// transforms.json maps a model ID (`*` matches any text; an exact ID wins, then the longest pattern) to the reviewed
// renderer evidence: `ops` is the whole transform, `living` is inserted where LivingEntityRenderer calls scale(...),
// and `before` limits an entry to versions older than the given one. A list of entries holds the alternatives for
// one ID, oldest first: the first one that applies wins. Every other model gets the living default.
export async function applyTransforms(records, version, entries) {
  entries ??= JSON.parse(await readFile(new URL('./transforms.json', import.meta.url), 'utf8'));
  for (const model of records) {
    const entry = model.id.startsWith('minecraft:') ? find(entries, model.id.slice(10), version) : undefined;
    model.transform = structuredClone(entry?.ops ?? [...LIVING_HEAD, ...(entry?.living ?? []), ...LIVING_TAIL]);
  }
  return records;
}
