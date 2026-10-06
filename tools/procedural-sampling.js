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
