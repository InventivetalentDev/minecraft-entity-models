const TOLERANCE = 0.01;

// Coefficients use vanilla's index-based Catmull-Rom tangents, including clamped endpoints.
function coefficients(frames, index, axis, interpolation) {
  const a = frames[index - 1].value[axis];
  const b = frames[index].value[axis];
  if (interpolation === 'linear') return [a, (frames[index].pre?.[axis] ?? b) - a, 0, 0];
  const previous = frames[Math.max(0, index - 2)].value[axis];
  const next = frames[Math.min(frames.length - 1, index + 1)].value[axis];
  return [a, (b - previous) / 2, previous - 2.5 * a + 2 * b - next / 2,
    (next - previous) / 2 + 1.5 * (a - b)];
}

function value([a, b, c, d], time) {
  return ((d * time + c) * time + b) * time + a;
}

// A cubic minus each source segment is another cubic. Its extrema bound the error between samples.
function segmentError(source, frames, index, interpolation, tolerance) {
  const start = frames[index - 1].time;
  const duration = frames[index].time - start;
  let maximum = 0;
  let low = 0;
  let high = source.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (source[middle].time <= start) low = middle + 1;
    else high = middle;
  }
  const polynomials = [0, 1, 2].map(axis => coefficients(frames, index, axis, interpolation));
  for (let right = Math.max(1, low); right < source.length && source[right - 1].time < start + duration; right++) {
    const a = source[right - 1];
    const b = source[right];
    const from = Math.max(0, (a.time - start) / duration);
    const to = Math.min(1, (b.time - start) / duration);
    for (let axis = 0; axis < 3; axis++) {
      const slope = ((b.pre ?? b.value)[axis] - a.value[axis]) * duration / (b.time - a.time);
      const difference = [...polynomials[axis]];
      difference[0] -= a.value[axis] + slope * (start - a.time) / duration;
      difference[1] -= slope;
      const points = [from, to];
      const quadratic = 3 * difference[3];
      const linear = 2 * difference[2];
      const constant = difference[1];
      if (Math.abs(quadratic) < 1e-14) {
        if (Math.abs(linear) > 1e-14) points.push(-constant / linear);
      } else {
        const discriminant = linear * linear - 4 * quadratic * constant;
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant);
          points.push((-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic));
        }
      }
      for (const point of points) {
        if (point >= from && point <= to) maximum = Math.max(maximum, Math.abs(value(difference, point)));
      }
      if (maximum > tolerance) return maximum;
    }
  }
  return maximum;
}

function linearReduction(frames, tolerance) {
  const keep = new Set([0, frames.length - 1]);
  for (let index = 0; index < frames.length; index++) if (frames[index].pre) keep.add(index);
  const fixed = [...keep].sort((a, b) => a - b);
  const pending = fixed.slice(1).map((index, offset) => [fixed[offset], index]);
  while (pending.length) {
    const [left, right] = pending.pop();
    const a = frames[left];
    const b = frames[right];
    let worst = tolerance;
    let selected = -1;
    for (let index = left + 1; index < right; index++) {
      const amount = (frames[index].time - a.time) / (b.time - a.time);
      for (let axis = 0; axis < 3; axis++) {
        const error = Math.abs(frames[index].value[axis] -
          (a.value[axis] + ((b.pre ?? b.value)[axis] - a.value[axis]) * amount));
        if (error > worst) { worst = error; selected = index; }
      }
    }
    if (selected !== -1) {
      keep.add(selected);
      pending.push([left, selected], [selected, right]);
    }
  }
  return [...keep].sort((a, b) => a - b).map(index => ({ ...frames[index], interpolation: 'linear' }));
}

function resample(source, count) {
  let right = 1;
  const start = source[0].time;
  const length = source.at(-1).time - start;
  const frames = Array.from({ length: count }, (_, index) => {
    if (index === 0) return { ...source[0] };
    if (index === count - 1) return { ...source.at(-1) };
    const time = start + length * index / (count - 1);
    while (source[right].time < time) right++;
    if (source[right].time === time) return { ...source[right] };
    const a = source[right - 1];
    const b = source[right];
    const amount = (time - a.time) / (b.time - a.time);
    return { time, value: a.value.map((value, axis) => value + ((b.pre ?? b.value)[axis] - value) * amount), interpolation: 'linear' };
  });
  for (const frame of source) {
    if (frame.pre && !frames.some(sample => sample.time === frame.time)) frames.push({ ...frame });
  }
  return frames.sort((a, b) => a.time - b.time);
}

function interpolation(source, frames, index, tolerance) {
  const straight = segmentError(source, frames, index, 'linear', tolerance);
  // Catmull-Rom ignores pre and can pull a neighboring segment across the jump.
  const curved = frames.slice(Math.max(0, index - 1), index + 2).some(frame => frame.pre) ? Infinity :
    segmentError(source, frames, index, 'catmullrom', tolerance);
  if (Math.min(straight, curved) > tolerance) return null;
  return curved < straight ? 'catmullrom' : 'linear';
}

function prune(source, frames, tolerance) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let removed = 1; removed < frames.length - 1; removed++) {
      if (frames[removed].pre) continue;
      const [frame] = frames.splice(removed, 1);
      const changes = [];
      // Removing a frame changes the joined segment and both neighboring spline tangents.
      for (let index = Math.max(1, removed - 1); index <= Math.min(frames.length - 1, removed + 1); index++) {
        changes.push([index, interpolation(source, frames, index, tolerance)]);
      }
      if (changes.every(([, method]) => method)) {
        for (const [index, method] of changes) frames[index].interpolation = method;
        changed = true;
      } else frames.splice(removed, 0, frame);
    }
  }
  return frames;
}

export function decimateChannel(source, tolerance = TOLERANCE) {
  if (source.length <= 2) return source;
  const linear = linearReduction(source, tolerance);
  for (let count = 3; count < linear.length; count++) {
    const candidate = resample(source, count);
    if (candidate.length >= linear.length) break;
    let valid = true;
    for (let index = 1; index < candidate.length; index++) {
      const method = interpolation(source, candidate, index, tolerance);
      if (!method) { valid = false; break; }
      candidate[index].interpolation = method;
    }
    if (valid) return prune(source, candidate, tolerance);
  }
  return prune(source, linear, tolerance);
}

// Only the procedural Java dump passes here; native AnimationDefinition data stays untouched.
export function decimateProceduralAnimations(dump) {
  const cache = new Map();
  for (const entry of dump) {
    for (const animation of Object.values(entry.animations)) {
      for (const channels of Object.values(animation.bones)) {
        for (const channel of channels) {
          const key = JSON.stringify(channel.keyframes);
          if (!cache.has(key)) cache.set(key, decimateChannel(channel.keyframes));
          channel.keyframes = cache.get(key);
        }
      }
    }
  }
  return dump;
}
