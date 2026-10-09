import { nativeAnimations26, normalizeAnimationRoots26 } from './animations-26.js';

const DEFAULT = {
  normalizeModels: records => records,
  nativeAnimations: dump => dump,
  samplerLibraries: [],
};
const CLASSIC = {
  samplerLibraries: [{ downloads: { artifact: {
    url: 'https://repo.maven.apache.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar',
    sha1: '25ea2e8b0c338a877313bd4672d3fe056ea78f0d',
  } } }],
};
const ADAPTERS = {
  '1.17.1': CLASSIC,
  '1.20.1': CLASSIC,
  '26.1.2': { normalizeModels: normalizeAnimationRoots26, nativeAnimations: nativeAnimations26 },
};

export function extractionAdapter(version) {
  return { ...DEFAULT, ...ADAPTERS[version] };
}
