# minecraft-entity-models

Minecraft entity and block-entity geometry, with one branch per version (for example, `1.21.11`). `main` contains tooling, tests, and this README. The branch layout follows [minecraft-assets](https://github.com/InventivetalentDev/minecraft-assets).

Files use `https://assets.mcasset.cloud/<version>/entity-models/<path>`, for example `https://assets.mcasset.cloud/1.21.11/entity-models/minecraft/cow.json`. Every model uses `minecraft/<id>.json`; slashes in IDs become subdirectories, such as `minecraft/boat/oak.json`. Each directory has `_list.json` with sorted `directories` and `files` arrays. `version.json` contains the Mojang manifest entry, including `id`.

Each model file groups every registered layer for one model ID:

```json
{
  "id": "minecraft:cow",
  "layers": {
    "main": {
      "texture": [64, 32],
      "textureLocation": "minecraft:textures/entity/cow/cow.png",
      "root": {
        "texture": [32, 32],
        "pose": {
          "offset": [0, 0, 0], "rotation": [0, 0, 0],
          "scale": [0.5, 0.5, 0.5]
        },
        "cubes": [{"origin": [-4, -4, -4], "size": [8, 8, 8], "uv": [0, 0]}],
        "children": {}
      }
    }
  }
}
```

Children repeat the root part shape. Rotations are radians; coordinates and UVs use Minecraft's model units. Cubes optionally include `grow: [x, y, z]` and `mirror: true`; zero growth and false mirroring are omitted. Object keys are sorted in generated files.

Part `texture` is optional, differs from the inherited size (the nearest ancestor override or the layer size), and applies to that part and its descendants until overridden. A child may restore the layer size. Only the legacy converter emits it. `pose.scale` is optional and omitted for `[1, 1, 1]`. Zero texture dimensions identify untextured geometry. Cube UV scaling and face masks are outside this schema.

Models use vanilla model space. Top-level `transform` lists the operations the vanilla renderer applies to the pose stack before it draws the model, in call order, so the last operation is applied to the vertices first. It is always present and `[]` means identity. Each operation is `{"scale": [x, y, z]}`, `{"translate": [x, y, z]}` in model units, or `{"rotate": [x, y, z]}` in radians with the same convention as `pose.rotation`. Most models get the living-entity default `[{"rotate": [0, 3.1415927, 0]}, {"scale": [-1, -1, 1]}, {"translate": [0, -24.016, 0]}]`; `tools/transforms.json` lists the reviewed exceptions.

`transform` describes the default state: an entity with yaw 0, default size and no animation, or a block entity with zero facing rotation and its animation at rest. State-dependent operations are evaluated there and dropped when they become identity; constant operations stay. Operations that a renderer applies to single parts are not included, such as the banner flag offset and the end crystal glass and cube before 1.21.2, and the conduit eye and cage. After `transform`, a block-entity model is in block space (0 to 16 on each axis), and a block state adds its Y rotation about the vertical axis through the block centre.

A layer's optional `render` names the vanilla render type that draws its geometry; it is omitted for `cutout`. Top-level `passes` lists, in draw order, the extra draws that the vanilla renderer adds on top of `main`: `{"layer", "textureLocation"?, "render"?, "when"?, "tint"?}`. `layer` names a layer of the same file, and a pass on `main` draws that geometry again. `textureLocation` and `render` are present only when they differ from the layer's own. Without `when`, vanilla attempts the draw in every state; otherwise `when` labels the entity state that enables it (`powered`, `tamed`, `not_sheared`, `dyed`, `eyes_glowing`, `tendrils_active`, `not_underwater`). `tint` labels a state colour that multiplies the texture (`wool_color`, `collar_color`). Alpha animation, equipment, held items, and passes with a texture chosen at runtime are not listed. `tools/passes.json` holds the reviewed entries with their evidence; `since` limits an entry to that version and later. The 1.16.5 feature layers use `tools/legacy-passes.js`.

| `render` | Vanilla render type | Meaning |
|---|---|---|
| `cutout` (default) | `entityCutoutNoCull` | Alpha-tested, lit, both faces drawn. |
| `cutout_cull` | `entityCutout` | As `cutout`, with back faces culled. |
| `cutout_z_offset` | `entityCutoutNoCullZOffset` | As `cutout`, with a depth offset toward the camera. |
| `solid` | `entitySolid` | Opaque, lit, back faces culled; texture alpha is ignored. |
| `translucent` | `entityTranslucent` | Alpha-blended, lit, both faces drawn. |
| `translucent_emissive` | `entityTranslucentEmissive`, `breezeEyes` | Alpha-blended, full-bright, no depth write. |
| `eyes` | `eyes` | Full-bright and blended, no depth write, no overlay. |
| `energy_swirl` | `energySwirl` | Additive, full-bright; the UV offset scrolls with entity age. |
| `breeze_wind` | `breezeWind` | Alpha-blended, lit; the U offset scrolls with entity age. |
| `water_mask` | `waterMask` | Writes depth only, to keep water out of a boat. |

Optional `textureLocation` values identify default textures using heuristics plus overrides and are omitted when unknown.

## Block index

`blocks.json` at the root of a version maps block IDs to the models their block-entity renderer draws. Vanilla block models have no geometry for these blocks.

```json
{
  "minecraft:trapped_chest": {
    "parts": [
      {"model": "minecraft:chest", "textureLocation": "minecraft:textures/entity/chest/trapped.png", "when": {"type": "single"}},
      {"model": "minecraft:double_chest_left", "textureLocation": "minecraft:textures/entity/chest/trapped_left.png", "when": {"type": "left"}},
      {"model": "minecraft:double_chest_right", "textureLocation": "minecraft:textures/entity/chest/trapped_right.png", "when": {"type": "right"}}
    ],
    "rotation": {"property": "facing", "degrees": {"east": 90, "north": 180, "south": 0, "west": 270}}
  },
  "minecraft:skeleton_wall_skull": {
    "parts": [{"model": "minecraft:skeleton_skull"}],
    "rotation": {"property": "facing", "degrees": {"east": 270, "north": 0, "south": 180, "west": 90}},
    "translation": [0, 4, 4]
  }
}
```

- `parts`: draw every part whose `when` matches the block state. `when` uses the syntax of blockstate multipart conditions: all properties must match, and `a|b` matches either value. `layer` defaults to `main`. `textureLocation` is present only when it differs from the model layer's default.
- `rotation`: a rotation about the block's vertical centre axis, selected by the block-state property `property`. It is either `degrees` (property value to angle) or `step` (angle = numeric property value × `step`, used for the 0–15 `rotation` property). Angles are degrees counter-clockwise seen from above (right-handed about +Y, like vanilla's `Axis.YP`); blockstate `y` rotations turn the other way.
- `translation`: an offset in model units, applied before the rotation, so it turns with the model.

The index holds only what depends on the block and its state. Apply it after the model's own constant placement, which is the renderer's pose with the facing angle (`toYRot()` or `rotation` × 22.5) at zero. At zero, chests, beds, decorated pots, signs, hanging signs and banners are in their `facing=south` (or `rotation=0`) pose and face south (+Z; a bed's head end points south); skulls and heads face north (−Z), the pose of `rotation=0` and of a wall skull with `facing=north`.

Shulker boxes have no `rotation`: their `facing` is not a rotation about the vertical axis, and the entry describes `facing=up`. Banner entries carry no colour because the base colour is a tint. Lid angles, animation, player skins, banner patterns, pot sherds and sign text are not part of the index.

Block families are described in `tools/block-families.json` and expanded per version by `tools/blocks.js`. Parts whose model is missing in a version and blocks without a blockstate file in that version are left out. Older renderers share geometry between block states: extraction adds separate standing and wall signs, banner layers, and shulker-box geometry while retaining the original model IDs. In 1.20.1 it also separates hanging-sign attachment shapes.

## Animations

Animations are in a separate tree: `animations/minecraft/<id>.json`, with its own `_list.json` files. Extraction reads vanilla keyframe definitions (`net.minecraft.client.animation.definitions`, Minecraft 1.19+) and samples reviewed procedural model poses in 1.16.5, 1.17.1, 1.20.1, 1.21.11, and 26.1.2. A version without extracted animations has no `animations` directory.

Keyframe definitions map to each model ID whose `main` layer is drawn by a model class that uses the definitions, or by a subclass of one. In 26.1.2, reviewed associations distinguish adult and baby definitions that accept the same layer shapes. Procedural profiles name their model IDs and layers explicitly.

```json
{
  "id": "minecraft:warden",
  "animations": {
    "emerge": {
      "length": 6.68, "loop": false,
      "bones": {
        "body": {
          "position": [{"time": 0.52, "value": [0, 56, 0], "interpolation": "catmullrom"}],
          "rotation": [{"time": 0.52, "value": [0, 0, -0.3926991], "interpolation": "catmullrom"}]
        }
      }
    }
  }
}
```

Definition names are the lower-case field names, without the mob prefix when every field of the class has it. Procedural profiles assign their clip names. A clip's optional `layer` selects a model layer and defaults to `main`; banner sway uses `"layer": "flag"`. A bone is a part name anywhere in that layer, and `root` is the layer's root part. A bone has up to three channels (`position`, `rotation`, `scale`), each with keyframes in time order.

Values come from the game's runtime floats; procedural curves may resample them during keyframe reduction. `time` and `length` are seconds, `rotation` is radians, `position` uses model units in the part space of `pose.offset` (vanilla has already negated the Y of its Y-up source values), and `scale` is the scale minus one. Before each frame vanilla resets every part to its default pose, then adds the sampled vector of each channel to the part's offset, rotation, or scale; `[0, 0, 0]` therefore leaves the part unchanged. The elapsed time is taken modulo `length` when `loop` is true. Between keyframes A and B, the `interpolation` of B applies: `linear` interpolates from A to B, and `catmullrom` is a Catmull-Rom spline through the keyframe before A, A, B, and the keyframe after B (indexes clamp at the ends). The first value applies before the first keyframe and the last value after the last one.

A 1.21.11 keyframe holds a value to arrive at and a value to leave from (1.20.1 has one value). `value` is the one to leave from; optional `pre` is the one to arrive at, is omitted when equal, and replaces B's `value` in `linear` interpolation only. No native 1.21.11 definition uses it. Sampled clips use it for pose discontinuities, including the bell's final reset.

1.20.1 ignores a bone that the model lacks (its warden animations `emerge` and `roar` name `left_ear` and `right_ear`), and extraction prints such bones as warnings. 1.21.11 rejects them when the model is created.

### Procedural poses

`tools/ProceduralAnimations.java` invokes the game's model methods with inputs from the procedural profiles. For stateless clips, it resets each part to its baked pose before each sample. It exports the difference from the baked pose, including nonzero resting offsets. The existing keyframe definitions stay unchanged. Profiles select reviewed classes, state fields, and controller timings per release; other versions still extract their native definitions.

`tools/procedural-blocks.js` covers chest and double-chest lids, shulker boxes, directional bell swings, standing and wall banners, dragon and piglin heads, and enchanting books. Chest, box, and book opening and closing take about 0.5 seconds. Chest inputs include the renderer's cubic easing. Bell swings end at 2.5 seconds with a jump to rest. Banner sway targets the `flag` layer. Book clips hold page-flip input at zero; their idle phase begins where the opening clip ends.

`tools/procedural-entities.js` covers reviewed mob cycles and transitions, including fish swimming, wing and tentacle motion, boat rowing, rabbit jumps, evoker fangs, shulker lids, sheep eating, wolf shaking, and golem and ravager actions. `tools/procedural-humanoids.js` adds walking previews for players, skeletons, zombies, piglins, endermen, and illagers. Shared geometry variants and baby models receive their own samples. The profiles specify which state inputs drive each clip and which remain fixed.

`tools/procedural-classic.js` adapts 1.17.1 and 1.20.1 model methods, which read entity getters rather than render-state objects. Reviewed fixtures supply those values without creating a world. Block renderer formulas live in `tools/procedural-classic-blocks.js`. Axolotl poses retain vanilla's rotation history within each finite sample and start each clip with an empty cache. `tools/animations-26.js` selects the renamed adult classes and separate baby models in 26.1.2; models that switched to native definitions retain those definitions instead of the earlier procedural clips.

The 1.16.5 runtime supplements the legacy dumps without renaming their existing parts. Where numeric child names cannot identify an animation target uniquely, it adds an `animated` layer with a named hierarchy. Draw it in place of `main`, including any passes that redraw `main`; retain each pass's texture, render mode, condition, and tint. This preserves dragon and phantom eyes and tamed-wolf collars. The two layers are alternative representations of the same model; `animated` is not a render pass.

MineRender's explicit `layer`/`layers` selection omits all passes. To preserve them when using `animated`, first resolve the normal draws with the desired `when` states, then replace only their geometry. For an existing `scene` and a `key` identifying a 1.16.5 wolf:

```js
const selected = await Entities.getEntity(key, undefined, { when: ['tamed'] });
const animated = await Entities.getEntity(key, undefined, { layer: 'animated' });
if (!selected || !animated) throw new Error('Wolf model not found');
const layers = Object.fromEntries(Object.entries(selected.layers).map(([name, draw]) =>
  name.split('#')[0] === 'main'
    ? [name.replace(/^main/, 'animated'), { ...draw, layer: animated.layer }]
    : [name, draw]));
const model = { ...selected, ...layers.animated, layers };
const entity = await scene.addEntity(model, { tints: { collar_color: 0xff0000 } });
```

The clip's `animated` layer targets both `animated` and `animated#2`, keeping the collar's pose aligned with the body.

Armor, outer clothing, and sheep wool have separate clips whose names end in the layer name, such as `walk_cycle_boots` and `eat_wool`. Play these alongside the corresponding main-layer clip. In 1.16.5, 1.17.1, and 1.20.1, humanoid armor uses vanilla's body-to-armor pose copy and retains the main clip's length and loop setting; piglin armor uses `walk_sample_inner_armor` and `walk_sample_outer_armor`. Each clip carries its own `layer` and deltas from that layer's baked pose.

Times assume 20 game ticks per second. Profiles sample poses at 120–480 samples per second to form a dense linear reference. `tools/procedural-decimation.js` reduces each bone channel using linear and Catmull-Rom interpolation, with a maximum error of 0.01 per axis against that reference (radians for rotation, model units for position, and scale units for scale). The bound includes times between source samples. The first and last frame's times and values, and every explicit `pre` discontinuity, stay exact.

Clips named `walk_cycle` and `swim_cycle` are movement previews with the fixed input rates recorded in the profile; walking amplitude is one. Their duration does not prescribe an entity's in-game speed. Humanoid `walk_cycle` clips hold `ageInTicks` at zero, so `AnimationUtils.bobModelPart` contributes a constant outward arm `zRot` of 0.1 radians, its maximum; in-game it sways between 0 and 0.1. `walk_sample` previews do not loop because their parts use different phase frequencies. Unset inputs retain the render state's defaults, including neutral look and inactive actions. Illager walking selects neutral, separate arms; the caller must hide the crossed-arms part.

Play each sampled clip as a complete pose relative to the baked model. These clips do not encode the game's state machine or define how to blend simultaneous actions. To reverse a partially opened lid, retain its progress and seek the opposite clip to the matching pose. Age-dependent motions use a fixed starting phase, so arbitrary transitions between them need phase coordination.

Only model-part position, rotation, and scale are sampled. Visibility, renderer pose-stack motion (such as decorated-pot wobble, conduit motion, and book bobbing), camera tracking, randomized behavior, and shader effects remain outside the animation schema. The allay's nested part named `root` cannot be distinguished from the layer root by this bone-name schema. End-crystal quaternion rotations need separate handling at Euler-angle discontinuities. Neither has a procedural profile. Other mixed or state-dependent motions need explicit input profiles; the extractor does not infer a fixed clip by varying every state field.

Use Node.js 18+ and a JDK: Java 17+ for older releases, Java 21+ for 1.21.11, and Java 25+ for 26.1.2. Set `JAVA_HOME` to choose a JDK. Downloads are SHA-1 checked; [AutoRenamingTool](https://github.com/neoforged/AutoRenamingTool) 2.0.18 is pinned by hash. The unobfuscated 26.1.2 client is read directly without remapping.

1. Extract Minecraft 1.17+ (add `--cache DIR` to change the cache or `--offline` to use cached downloads):
   ```sh
   node tools/extract.js --version 1.21.11 --output out/1.21.11
   ```
2. Convert the legacy [entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/main/packages/minerender/src/entity/entityModels.json) and [block-entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/main/packages/minerender/src/entity/blockEntityModels.json), supplementing missing geometry, render layers, and procedural poses from the 1.16.5 runtime. Existing part names remain intact; unnamed children use numeric keys. The runtime uses pinned Yarn 1.16.5 build 6 mappings. `--cache` holds shared client downloads, libraries, and the checksum-verified mapped jar; `--legacy-cache` selects the Yarn and remapper download directory. `--offline` uses cached downloads:
   ```sh
   node tools/convert-legacy.js entityModels.json blockEntityModels.json --output out/1.16.5
   ```
3. Create or update a version branch in a temporary Git worktree; the helper commits with the version as its message and prints the push command without pushing:
   ```sh
   node tools/publish.js --version 1.21.11 --input out/1.21.11
   ```

Extraction and conversion require a new output directory. Run tests with `node --test`.

- 1.16.5: 132 model files, 84 animation files, 162 sampled clips, 98 block entries.
- 1.17.1: 145 model files, 87 animation files, 160 sampled clips, 98 block entries.
- 1.20.1: 219 model files, 105 animation files, 225 clips (27 native and 198 sampled), 129 block entries.
- 1.21.11: 289 model files, 178 animation files, 408 clips (74 native and 334 sampled). This includes 60 sampled clips in the 20 nested `boat/` and `chest_boat/` files; counting only top-level animation files gives 348 clips (74 native and 274 sampled).
- 26.1.2: 283 model files, 173 animation files, 405 clips (87 native and 318 sampled), 141 block entries.
