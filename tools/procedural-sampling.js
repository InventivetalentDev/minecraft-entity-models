// Sample method inputs in seconds; the Java sampler evaluates the game's model poses.
export function clip(length, loop, valuesAt, { samplesPerSecond = 120, end } = {}) {
  const count = Math.max(1, Math.ceil(length * samplesPerSecond));
  const frames = Array.from({ length: count + 1 }, (_, index) => {
    const time = index * length / count;
    return { time, values: valuesAt(time) };
  });
  if (end) {
    frames.at(-1).pre = frames.at(-1).values;
    frames.at(-1).values = end;
  }
  return { length, loop, frames };
}

export function remapClips(clips, convert, rename = name => name) {
  return Object.fromEntries(Object.entries(clips).map(([name, animation]) => [rename(name), {
    ...animation,
    frames: animation.frames.map(frame => ({ ...frame, values: convert(frame.values), ...(frame.pre ? { pre: convert(frame.pre) } : {}) })),
  }]));
}

// These controllers decrement integer tick counters. Explicit pre frames retain tick-boundary jumps.
export function countdown(ticks, values) {
  const animation = clip(ticks / 20, false, time => {
    const tick = Math.min(ticks - 1, Math.floor(time * 20));
    return values(ticks - tick, time * 20 - tick);
  }, { samplesPerSecond: 480, end: values(0, 0) });
  for (let tick = 1; tick < ticks; tick++) {
    const time = tick / 20;
    animation.frames = animation.frames.filter(frame => Math.abs(frame.time - time) > 1e-10);
    animation.frames.push({ time, values: values(ticks - tick, 0), pre: values(ticks - tick + 1, 1) });
  }
  animation.frames.sort((a, b) => a.time - b.time);
  return animation;
}

export function steppedClip(ticks, valuesAtTick) {
  const animation = clip(ticks / 20, false, time => valuesAtTick(Math.floor(time * 20)));
  for (let tick = 1; tick <= ticks; tick++) {
    const time = tick / 20;
    animation.frames = animation.frames.filter(frame => Math.abs(frame.time - time) > 1e-10);
    animation.frames.push({ time, values: valuesAtTick(tick), pre: valuesAtTick(tick - 1) });
  }
  animation.frames.sort((a, b) => a.time - b.time);
  return animation;
}

export function squidTentacleAngle(tick) {
  const phase = tick * 2 * Math.PI / 32;
  return phase < Math.PI ? Math.sin(phase * phase / Math.PI) * Math.PI / 4 : 0;
}
