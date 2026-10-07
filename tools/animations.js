const TARGETS = ['position', 'rotation', 'scale'];
const INTERPOLATIONS = ['catmullrom', 'linear'];

function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Expected object with keys: ${required.join(', ')}`);
  }
}

function vector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error('Expected 3 finite numbers');
}

function entries(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`Expected at least one ${label}`);
  }
  return Object.entries(value);
}

export function validateAnimations(data) {
  object(data, ['id', 'animations']);
  if (typeof data.id !== 'string') throw new Error('Expected a model id');
  for (const [name, animation] of entries(data.animations, 'animation')) {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid animation name: ${name}`);
    object(animation, ['length', 'loop', 'bones'], ['layer']);
    if (Object.hasOwn(animation, 'layer') && (typeof animation.layer !== 'string' ||
        !/^[a-z0-9_./-]+$/.test(animation.layer) || animation.layer === 'main')) {
      throw new Error('Animation layer must name a non-main layer');
    }
    if (!Number.isFinite(animation.length) || animation.length < 0) throw new Error('Animation length must be a nonnegative number');
    if (typeof animation.loop !== 'boolean') throw new Error('Animation loop must be a boolean');
    for (const [, channels] of entries(animation.bones, 'bone')) {
      for (const [target, keyframes] of entries(channels, 'channel')) {
        if (!TARGETS.includes(target)) throw new Error(`Unknown animation channel: ${target}`);
        if (!Array.isArray(keyframes) || keyframes.length === 0) throw new Error('Expected at least one keyframe');
        let previous = 0;
        for (const keyframe of keyframes) {
          object(keyframe, ['time', 'value', 'interpolation'], ['pre']);
          if (!Number.isFinite(keyframe.time) || keyframe.time < previous) throw new Error('Keyframe times must be nonnegative and in order');
          previous = keyframe.time;
          vector(keyframe.value);
          if (!INTERPOLATIONS.includes(keyframe.interpolation)) throw new Error(`Unknown interpolation: ${keyframe.interpolation}`);
          if (Object.hasOwn(keyframe, 'pre')) {
            vector(keyframe.pre);
            if (keyframe.pre.every((number, index) => number === keyframe.value[index])) throw new Error('Omit pre matching value');
          }
        }
      }
    }
  }
  return data;
}

// For publish.js: a file below animations/ must be a valid animation file named after its model id.
export function validateAnimationFile(name, data) {
  const match = /^animations\/([a-z0-9_.-]+)\/([a-z0-9_./-]+)\.json$/.exec(name);
  if (!match) throw new Error(`Unexpected file: ${name}`);
  try {
    validateAnimations(data);
  } catch (error) {
    throw new Error(`${name}: ${error.message}`);
  }
  if (data.id !== `${match[1]}:${match[2]}`) throw new Error(`Animation id does not match its path: ${name}`);
}

// WARDEN_EMERGE in WardenAnimation → emerge; the mob prefix stays when any field of the class lacks it.
export function animationNames(className, fields) {
  const prefix = className.replace(/Animations?$/, '').replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toUpperCase() + '_';
  const strip = fields.every(field => field.startsWith(prefix) && field.length > prefix.length);
  const names = new Map(fields.map(field => [field, (strip ? field.slice(prefix.length) : field).toLowerCase()]));
  if (new Set(names.values()).size !== names.size) throw new Error(`Duplicate animation names in ${className}`);
  return names;
}

// Vanilla resolves the bone name root to the layer's root part.
function partNames(part, names = new Set(['root'])) {
  for (const [name, child] of Object.entries(part.children)) partNames(child, names.add(name));
  return names;
}

// dump: Animations.java output. Returns one file per model id and the findings of the mapping checks.
export function buildAnimations(dump, records) {
  const files = new Map();
  const findings = [];
  for (const entry of dump) {
    const names = animationNames(entry.class, Object.keys(entry.animations));
    const animations = {};
    for (const [field, definition] of Object.entries(entry.animations)) {
      const bones = {};
      for (const [bone, channels] of Object.entries(definition.bones)) {
        bones[bone] = {};
        for (const channel of channels) {
          if (Object.hasOwn(bones[bone], channel.target)) throw new Error(`${entry.class}.${field}: several ${channel.target} channels for ${bone}`);
          bones[bone][channel.target] = channel.keyframes;
        }
      }
      animations[names.get(field)] = { length: definition.length, loop: definition.loop, bones,
        ...(entry.layer && entry.layer !== 'main' ? { layer: entry.layer } : {}) };
    }
    if (entry.modelClasses.length === 0) findings.push(`${entry.class}: no model class references it`);
    else if (entry.modelIds.length === 0) findings.push(`${entry.class}: no model accepted by ${entry.modelClasses.join(', ')}`);
    for (const id of entry.modelIds) {
      const layer = entry.layer ?? 'main';
      const root = records.find(model => model.id === id)?.layers[layer]?.root;
      if (!root) throw new Error(`${id}: animation layer not found: ${layer}`);
      const parts = partNames(root);
      for (const [name, animation] of Object.entries(animations)) {
        const missing = Object.keys(animation.bones).filter(bone => !parts.has(bone));
        if (missing.length) findings.push(`${id} ${name}: bones not in the ${layer} layer: ${missing.join(', ')}`);
      }
      const file = files.get(id) ?? { id, animations: {} };
      for (const name of Object.keys(animations)) {
        if (Object.hasOwn(file.animations, name)) throw new Error(`Duplicate animation ${name} for ${id}`);
        file.animations[name] = animations[name];
      }
      files.set(id, file);
    }
  }
  return { animations: [...files.values()], findings };
}
