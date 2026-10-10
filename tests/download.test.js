import assert from 'node:assert/strict';
import test from 'node:test';
import { clientNeedsRemapping } from '../tools/download.js';
import { allowedLibrary } from '../tools/runtime.js';

test('clients without mappings require the named extraction classes', () => {
  assert.equal(clientNeedsRemapping({ downloads: { client_mappings: { sha1: 'mapped' } } }), true);
  const metadata = { downloads: { client: { sha1: 'named' } } };
  const entries = ['net/minecraft/SharedConstants.class', 'net/minecraft/client/model/geom/LayerDefinitions.class',
    'net/minecraft/client/model/geom/ModelLayers.class'];
  assert.equal(clientNeedsRemapping(metadata, entries), false);
  assert.throws(() => clientNeedsRemapping(metadata), /Client has no mappings and is missing named classes/);
  assert.throws(() => clientNeedsRemapping(metadata, entries.slice(0, 2)), /ModelLayers.class/);
});

test('library rules honor OS versions and ordered allow/disallow matches', () => {
  assert.equal(allowedLibrary({}), true);
  assert.equal(allowedLibrary({ rules: [] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { version: '.+' } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { version: '^$' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { version: '^$' } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { version: '.+' } }] }), false);
});
