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

Part `texture` is optional, differs from the inherited size (the nearest ancestor override or the layer size), and applies to that part and its descendants until overridden. A child may restore the layer size. Only the legacy converter emits it. `pose.scale` is optional and omitted for `[1, 1, 1]`. Zero texture dimensions identify untextured geometry. Texture paths, cube UV scaling, and face masks are outside this schema.

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
