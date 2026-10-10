import { nativeAnimations26, normalizeAnimationRoots26, proceduralAnimations26 } from './animations-26.js';

// Every per-release switch of the extractor is a field of this table, so a new release is one entry.
const DEFAULT = {
  normalizeModels: records => records,
  nativeAnimations: dump => dump,
  samplerLibraries: [],
  // Sign, banner and shulker-box models that older renderers select from shared layers at draw time.
  classicBlockModels: false,
  // The reviewed procedural profiles: 'classic', 'modern', or null when the release has none.
  procedural: null,
  proceduralRequests: requests => requests,
};
const CLASSIC = {
  classicBlockModels: true,
  procedural: 'classic',
  samplerLibraries: [{ downloads: { artifact: {
    url: 'https://repo.maven.apache.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar',
    sha1: '25ea2e8b0c338a877313bd4672d3fe056ea78f0d',
  } } }],
};
const ADAPTERS = {
  '1.17.1': CLASSIC,
  '1.20.1': CLASSIC,
  '1.21.11': { procedural: 'modern' },
  '26.1.2': { normalizeModels: normalizeAnimationRoots26, nativeAnimations: nativeAnimations26,
    procedural: 'modern', proceduralRequests: proceduralAnimations26 },
};

export function extractionAdapter(version) {
  return { ...DEFAULT, ...ADAPTERS[version] };
}
