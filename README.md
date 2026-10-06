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

A layer's optional `render` names the vanilla render type that draws its geometry; it is omitted for `cutout`. Top-level `passes` lists, in draw order, the extra draws that the vanilla renderer adds on top of `main`: `{"layer", "textureLocation"?, "render"?, "when"?, "tint"?}`. `layer` names a layer of the same file, and a pass on `main` draws that geometry again. `textureLocation` and `render` are present only when they differ from the layer's own. Without `when`, vanilla attempts the draw in every state; otherwise `when` labels the entity state that enables it (`powered`, `tamed`, `not_sheared`, `dyed`, `eyes_glowing`, `tendrils_active`, `not_underwater`). `tint` labels a state colour that multiplies the texture (`wool_color`, `collar_color`). Alpha animation, equipment, held items, and passes with a texture chosen at runtime are not listed. `tools/passes.json` holds the reviewed entries with their evidence; `since` limits an entry to that version and later, and 1.16.5 is not annotated.

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

Block families are described in `tools/block-families.json` and expanded per version by `tools/blocks.js`. Parts whose model is missing in a version and blocks without a blockstate file in that version are left out.

Use Node.js 18+ and a JDK: Java 17+ for older releases, Java 21+ for 1.21.11. Set `JAVA_HOME` to choose a JDK. Downloads are SHA-1 checked; [AutoRenamingTool](https://github.com/neoforged/AutoRenamingTool) 2.0.18 is pinned by hash.

1. Extract Minecraft 1.17+ (add `--cache DIR` to change the cache or `--offline` to use cached downloads):
   ```sh
   node tools/extract.js --version 1.21.11 --output out/1.21.11
   ```
2. Convert the legacy [entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/main/packages/minerender/src/entity/entityModels.json) and [block-entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/main/packages/minerender/src/entity/blockEntityModels.json) into one `main` layer per ID; empty IDs are skipped and unnamed children use numeric keys:
   ```sh
   node tools/convert-legacy.js entityModels.json blockEntityModels.json --output out/1.16.5
   ```
3. Create or update a version branch in a temporary Git worktree; the helper commits with the version as its message and prints the push command without pushing:
   ```sh
   node tools/publish.js --version 1.21.11 --input out/1.21.11
   ```

Extraction and conversion require a new output directory. Run tests with `node --test`.

- 1.16.5: 86 model files.
- 1.17.1: 126 model files.
- 1.20.1: 161 model files.
- 1.21.11: 289 model files.
