import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import javax.tools.ToolProvider;
import net.minecraft.Bootstrap;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.block.entity.BlockEntityRenderDispatcher;
import net.minecraft.client.render.block.entity.ShulkerBoxBlockEntityRenderer;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.render.entity.model.ShulkerEntityModel;
import net.minecraft.entity.EntityType;
import net.minecraft.resource.ReloadableResourceManagerImpl;
import net.minecraft.resource.ResourceType;
import net.minecraft.util.registry.Registry;

/** Retains legacy field names while extracting omitted model arrays, feature layers, and sampled poses. */
@SuppressWarnings("unchecked")
public class LegacyModels {
    private static final String[] COMPONENTS = {"pivotX", "pivotY", "pivotZ", "pitch", "yaw", "roll"};
    private static final Map<String, String> BLOCKS = Map.ofEntries(
        Map.entry("chest", "Chest"), Map.entry("trapped_chest", "Chest"), Map.entry("ender_chest", "Chest"),
        Map.entry("enchanting_table", "EnchantingTable"), Map.entry("lectern", "Lectern"),
        Map.entry("sign", "Sign"), Map.entry("banner", "Banner"), Map.entry("bed", "Bed"),
        Map.entry("conduit", "Conduit"), Map.entry("bell", "Bell"));
    private static final Map<String, String> FEATURES = Map.ofEntries(
        Map.entry("SheepWoolFeatureRenderer", "fur"), Map.entry("CatCollarFeatureRenderer", "collar"),
        Map.entry("CreeperChargeFeatureRenderer", "armor"), Map.entry("WitherArmorFeatureRenderer", "armor"),
        Map.entry("SlimeOverlayFeatureRenderer", "outer"), Map.entry("DrownedOverlayFeatureRenderer", "outer"),
        Map.entry("StrayOverlayFeatureRenderer", "outer"), Map.entry("HorseArmorFeatureRenderer", "armor"),
        Map.entry("LlamaDecorFeatureRenderer", "decor"), Map.entry("SaddleFeatureRenderer", "saddle"));
    private static final Map<Class<?>, Class<?>> STUBS = new LinkedHashMap<>();
    private static Path work;

    private static class Layer {
        final Map<String, ModelPart> parts = new LinkedHashMap<>();
        final List<Object> models = new ArrayList<>();
        final java.util.Set<String> aliases = new java.util.HashSet<>();
        boolean named;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: LegacyModels.java INPUT OUTPUT");
        work = Path.of(args[1]).toAbsolutePath().getParent();
        Bootstrap.initialize();
        // Guardian poses read the camera entity; a null camera needs no client, world, or window setup.
        Class<?> client = Class.forName("net.minecraft.client.MinecraftClient");
        Field instance = client.getDeclaredField("instance");
        instance.setAccessible(true);
        if (instance.get(null) == null) instance.set(null, allocate(client));
        Map<String, Map<String, Layer>> models = new TreeMap<>();
        try (var resources = new ReloadableResourceManagerImpl(ResourceType.CLIENT_RESOURCES)) {
            var dispatcher = new EntityRenderDispatcher(null, null, resources, null, null);
            for (var entry : ((Map<EntityType<?>, Object>) field(dispatcher, "renderers")).entrySet()) {
                addRenderer(models, Registry.ENTITY_TYPE.getId(entry.getKey()).toString(), entry.getValue());
            }
            for (var entry : ((Map<String, Object>) field(dispatcher, "modelRenderers")).entrySet())
                addRenderer(models, entry.getKey().equals("slim") ? "minecraft:player_slim" : "minecraft:player", entry.getValue());
        }
        for (var entry : BLOCKS.entrySet()) {
            Class<?> type = Class.forName("net.minecraft.client.render.block.entity." + entry.getValue() + "BlockEntityRenderer");
            addRenderer(models, "minecraft:" + entry.getKey(), type.getConstructor(BlockEntityRenderDispatcher.class).newInstance(new Object[] {null}));
        }
        addRenderer(models, "minecraft:shulker_box", new ShulkerBoxBlockEntityRenderer(new ShulkerEntityModel<>(), null));
        Class<?> skullRenderer = Class.forName("net.minecraft.client.render.block.entity.SkullBlockEntityRenderer");
        Field skullModels = skullRenderer.getDeclaredField("MODELS");
        skullModels.setAccessible(true);
        Map<String, String> skullIds = Map.of("SKELETON", "skeleton_skull", "WITHER_SKELETON", "wither_skeleton_skull",
            "ZOMBIE", "zombie_head", "CREEPER", "creeper_head", "DRAGON", "dragon_skull", "PLAYER", "player_head");
        for (var entry : ((Map<?, ?>) skullModels.get(null)).entrySet()) addRenderer(models, "minecraft:" + skullIds.get(entry.getKey().toString()), entry.getValue());
        for (var model : models.values()) {
            Layer main = model.get("main");
            if (main.parts.values().stream().anyMatch(part -> hasChildren(part))) model.put("animated", namedLayer(main));
        }
        JsonObject input = new JsonParser().parse(Files.readString(Path.of(args[0]))).getAsJsonObject();
        Map<String, Object> geometry = new TreeMap<>();
        Map<String, Object> inventory = new TreeMap<>();
        for (var model : models.entrySet()) {
            Map<String, Object> layers = new TreeMap<>();
            Map<String, Object> types = new TreeMap<>();
            for (var layer : model.getValue().entrySet()) {
                Map<String, Object> parts = new TreeMap<>();
                for (var part : layer.getValue().parts.entrySet()) {
                    if (layer.getValue().named && isChild(part.getValue(), layer.getValue().parts.values())) continue;
                    if (!layer.getValue().named && layer.getValue().aliases.contains(part.getKey()) && isChild(part.getValue(), layer.getValue().parts.values())) continue;
                    parts.put(part.getKey(), geometry(part.getValue(), layer.getValue().named ? layer.getValue().parts : null));
                }
                layers.put(layer.getKey(), parts);
                types.put(layer.getKey(), layer.getValue().models.stream().map(value -> value.getClass().getName()).toList());
            }
            geometry.put(model.getKey(), layers);
            inventory.put(model.getKey(), types);
        }
        List<Object> animations = new ArrayList<>();
        for (JsonElement element : input.getAsJsonArray("requests")) {
            JsonObject request = element.getAsJsonObject();
            String id = request.get("model").getAsString();
            String layerName = request.has("layer") ? request.get("layer").getAsString() : "main";
            Layer layer = models.get(id).get(layerName);
            if (layer == null) throw new IllegalArgumentException(id + ": missing " + layerName);
            Object model = layer.models.stream().filter(value -> !request.has("class") || value.getClass().getSimpleName().equals(request.get("class").getAsString())).reduce((previous, next) -> next).orElseThrow();
            String methodName = request.has("method") ? request.get("method").getAsString() : "setAngles";
            Method method = java.util.Arrays.stream(model.getClass().getMethods())
                .filter(value -> value.getName().equals(methodName) && !value.isBridge()).findFirst().orElseThrow(() -> new IllegalArgumentException(id + ": missing " + methodName));
            Layer local = new Layer();
            collect(model, local);
            if (layer.named) {
                Map<ModelPart, float[]> owned = snapshot(local.parts.values());
                local.parts.clear();
                for (var part : layer.parts.entrySet()) if (owned.containsKey(part.getValue())) local.parts.put(part.getKey(), part.getValue());
            } else local.parts.entrySet().removeIf(entry -> layer.parts.get(entry.getKey()) != entry.getValue() ||
                layer.aliases.contains(entry.getKey()) && isChild(entry.getValue(), layer.parts.values()));
            Map<ModelPart, float[]> defaults = snapshot(layer.parts.values());
            Map<String, Object> clips = new TreeMap<>();
            for (var entry : request.getAsJsonObject("clips").entrySet()) {
                try { clips.put(entry.getKey(), sample(model, method, local.parts, defaults, entry.getValue().getAsJsonObject(), request)); }
                catch (Throwable error) { throw new IllegalArgumentException(id + " " + entry.getKey() + ": " + error, error); }
            }
            restore(defaults);
            animations.add(object("class", model.getClass().getSimpleName(), "modelClasses", List.of(model.getClass().getName()),
                "modelIds", List.of(id), "layer", layerName, "animations", clips));
        }
        Files.writeString(Path.of(args[1]), new GsonBuilder().disableHtmlEscaping().create().toJson(
            object("models", geometry, "inventory", inventory, "animations", animations)) + "\n");
    }

    private static void addRenderer(Map<String, Map<String, Layer>> models, String id, Object renderer) throws Exception {
        Map<String, Layer> layers = new TreeMap<>();
        Layer main = new Layer();
        collect(renderer, main);
        main.parts.entrySet().removeIf(entry -> main.aliases.contains(entry.getKey()) && main.parts.entrySet().stream()
            .anyMatch(other -> !main.aliases.contains(other.getKey()) && other.getValue() == entry.getValue()));
        layers.put("main", main);
        Iterable<?> features;
        try { features = (Iterable<?>) field(renderer, "features"); }
        catch (NoSuchFieldException ignored) { features = List.of(); }
        for (Object feature : features) {
            if (feature.getClass().getSimpleName().equals("ArmorFeatureRenderer")) {
                for (String name : List.of("leggingsModel", "bodyModel")) {
                    Layer layer = new Layer();
                    collect(field(feature, name), layer);
                    layers.put(name.equals("leggingsModel") ? "inner_armor" : "outer_armor", namedLayer(layer));
                }
                continue;
            }
            String name = FEATURES.get(feature.getClass().getSimpleName());
            if (name == null) continue;
            Layer layer = new Layer();
            collect(feature, layer);
            if (!layer.parts.isEmpty()) layers.put(name, namedLayer(layer));
        }
        models.put(id, layers);
        if (id.equals("minecraft:tropical_fish") || id.equals("minecraft:pufferfish")) {
            for (Object model : main.models) {
                String type = model.getClass().getSimpleName();
                String size = type.startsWith("Small") ? "small" : type.startsWith("Medium") ? "medium" : "big";
                String variant = id + "_" + (id.endsWith("tropical_fish") && size.equals("big") ? "large" : size);
                addRenderer(models, variant, model);
                if (id.endsWith("tropical_fish")) for (Object feature : features) {
                    if (!feature.getClass().getSimpleName().equals("TropicalFishColorFeatureRenderer")) continue;
                    Layer pattern = new Layer();
                    collect(field(feature, size.equals("small") ? "smallModel" : "largeModel"), pattern);
                    models.get(variant).put("pattern", namedLayer(pattern));
                }
            }
        }
    }

    private static void collect(Object value, Layer layer) throws Exception {
        if (value == null) return;
        if (value instanceof Model) layer.models.add(value);
        for (Field field : fields(value.getClass())) {
            if (Modifier.isStatic(field.getModifiers())) continue;
            if (field.getType() == ModelPart.class) {
                ModelPart part = (ModelPart) read(field, value);
                if (part != null) layer.parts.put(field.getName(), part);
            }
            else if (field.getType().isArray() && field.getType().getComponentType() == ModelPart.class) {
                Object array = read(field, value);
                if (array == null) continue;
                for (int index = 0; index < Array.getLength(array); index++) {
                    String name = field.getName() + "_" + index;
                    layer.parts.put(name, (ModelPart) Array.get(array, index));
                    layer.aliases.add(name);
                }
            } else if (Iterable.class.isAssignableFrom(field.getType()) && read(field, value) instanceof Iterable<?> values) {
                int index = 0;
                for (Object item : values) {
                    if (item instanceof ModelPart part && !layer.parts.containsValue(part)) {
                        String name = field.getName() + "_" + index;
                        layer.parts.put(name, part);
                        layer.aliases.add(name);
                    }
                    index++;
                }
            } else if (Model.class.isAssignableFrom(field.getType())) collect(read(field, value), layer);
        }
    }

    private static boolean hasChildren(ModelPart part) {
        try { return ((List<?>) field(part, "children")).size() > 0; }
        catch (Exception error) { throw new IllegalArgumentException(error); }
    }

    private static boolean isChild(ModelPart part, Iterable<ModelPart> candidates) {
        try {
            for (ModelPart candidate : candidates) for (ModelPart child : (Iterable<ModelPart>) field(candidate, "children"))
                if (child == part || isChild(part, List.of(child))) return true;
            return false;
        } catch (Exception error) { throw new IllegalArgumentException(error); }
    }

    private static Layer namedLayer(Layer source) throws Exception {
        Layer layer = new Layer();
        layer.named = true;
        layer.models.addAll(source.models);
        for (var part : source.parts.entrySet()) if (!source.aliases.contains(part.getKey()) && !layer.parts.containsValue(part.getValue())) layer.parts.put(part.getKey(), part.getValue());
        for (var part : source.parts.entrySet()) if (!layer.parts.containsValue(part.getValue())) layer.parts.put(part.getKey(), part.getValue());
        for (var part : new ArrayList<>(layer.parts.entrySet())) nameChildren(part.getValue(), part.getKey(), layer.parts);
        return layer;
    }

    private static void nameChildren(ModelPart parent, String prefix, Map<String, ModelPart> names) throws Exception {
        int index = 0;
        for (ModelPart child : (Iterable<ModelPart>) field(parent, "children")) {
            String name = prefix + "_child_" + index++;
            if (!names.containsValue(child)) names.put(name, child);
            nameChildren(child, name, names);
        }
    }

    private static Object geometry(ModelPart part, Map<String, ModelPart> names) throws Exception {
        Map<String, Object> result = new TreeMap<>();
        for (String name : List.of("textureWidth", "textureHeight", "textureOffsetU", "textureOffsetV", "pivotX", "pivotY", "pivotZ", "pitch", "yaw", "roll", "mirror")) result.put(name, field(part, name));
        List<Object> cubes = new ArrayList<>();
        for (Object cube : (Iterable<?>) field(part, "cuboids")) {
            Map<String, Object> data = new TreeMap<>();
            for (String name : List.of("minX", "minY", "minZ", "maxX", "maxY", "maxZ")) data.put(name, field(cube, name));
            Object[] sides = (Object[]) field(cube, "sides");
            float[] min = {Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY};
            float[] max = {Float.NEGATIVE_INFINITY, Float.NEGATIVE_INFINITY, Float.NEGATIVE_INFINITY};
            float u = Float.POSITIVE_INFINITY, v = Float.POSITIVE_INFINITY;
            for (Object side : sides) for (Object vertex : (Object[]) field(side, "vertices")) {
                Object position = field(vertex, "pos");
                for (int axis = 0; axis < 3; axis++) {
                    float coordinate = ((Number) field(position, List.of("x", "y", "z").get(axis))).floatValue();
                    min[axis] = Math.min(min[axis], coordinate);
                    max[axis] = Math.max(max[axis], coordinate);
                }
                u = Math.min(u, ((Number) field(vertex, "u")).floatValue());
                v = Math.min(v, ((Number) field(vertex, "v")).floatValue());
            }
            List<Float> grow = new ArrayList<>();
            for (int axis = 0; axis < 3; axis++) {
                String coordinate = List.of("X", "Y", "Z").get(axis);
                float amount = ((Number) data.get("min" + coordinate)).floatValue() - min[axis];
                float opposite = max[axis] - ((Number) data.get("max" + coordinate)).floatValue();
                if (Math.abs(amount - opposite) > 0.0001f) throw new IllegalArgumentException("Asymmetric legacy cube growth");
                grow.add(Math.abs(amount) < 0.000001f ? 0f : amount);
            }
            data.put("grow", grow);
            data.put("uv", List.of(u * ((Number) field(part, "textureWidth")).floatValue(), v * ((Number) field(part, "textureHeight")).floatValue()));
            data.put("mirror", ((Number) field(field(sides[0], "direction"), "x")).floatValue() < 0);
            cubes.add(data);
        }
        result.put("cubes", cubes);
        List<Object> children = new ArrayList<>();
        for (ModelPart child : (Iterable<ModelPart>) field(part, "children")) {
            Map<String, Object> geometry = (Map<String, Object>) geometry(child, names);
            if (names != null) geometry.put("name", names.entrySet().stream().filter(entry -> entry.getValue() == child).findFirst().orElseThrow().getKey());
            children.add(geometry);
        }
        result.put("children", children);
        return result;
    }

    private static Map<ModelPart, float[]> snapshot(Iterable<ModelPart> parts) throws Exception {
        Map<ModelPart, float[]> result = new IdentityHashMap<>();
        for (ModelPart part : parts) snapshot(part, result);
        return result;
    }

    private static void snapshot(ModelPart part, Map<ModelPart, float[]> result) throws Exception {
        float[] pose = new float[COMPONENTS.length];
        for (int index = 0; index < pose.length; index++) pose[index] = ModelPart.class.getField(COMPONENTS[index]).getFloat(part);
        result.put(part, pose);
        for (ModelPart child : (Iterable<ModelPart>) field(part, "children")) snapshot(child, result);
    }

    private static void restore(Map<ModelPart, float[]> defaults) throws Exception {
        for (var entry : defaults.entrySet()) for (int index = 0; index < COMPONENTS.length; index++)
            ModelPart.class.getField(COMPONENTS[index]).setFloat(entry.getKey(), entry.getValue()[index]);
    }

    private static Object sample(Object model, Method method, Map<String, ModelPart> parts, Map<ModelPart, float[]> defaults, JsonObject clip, JsonObject request) throws Exception {
        Map<String, List<List<Object>>> frames = new TreeMap<>();
        for (String name : parts.keySet()) frames.put(name, List.of(new ArrayList<>(), new ArrayList<>()));
        Object entity = method.getParameterTypes()[0].isPrimitive() ? null : entity(request.has("entityClass") ? Class.forName(request.get("entityClass").getAsString()) : previewType(model.getClass(), method.getParameterTypes()[0]));
        for (JsonElement element : clip.getAsJsonArray("frames")) {
            JsonObject frame = element.getAsJsonObject();
            Map<ModelPart, float[]> before = null;
            if (frame.has("pre")) {
                pose(model, method, entity, defaults, frame.getAsJsonArray("pre"));
                before = snapshot(parts.values());
            }
            pose(model, method, entity, defaults, frame.getAsJsonArray("values"));
            for (var entry : parts.entrySet()) for (int channel = 0; channel < 2; channel++) {
                List<Float> vector = delta(entry.getValue(), defaults, channel);
                Map<String, Object> keyframe = object("time", frame.get("time").getAsDouble(), "value", vector, "interpolation", "linear");
                if (before != null) {
                    List<Float> previous = new ArrayList<>();
                    for (int axis = 0; axis < 3; axis++) {
                        float delta = before.get(entry.getValue())[channel * 3 + axis] - defaults.get(entry.getValue())[channel * 3 + axis];
                        previous.add(delta == 0 ? 0f : delta);
                    }
                    if (!previous.equals(vector)) keyframe.put("pre", previous);
                }
                frames.get(entry.getKey()).get(channel).add(keyframe);
            }
        }
        Map<String, Object> bones = new TreeMap<>();
        for (var entry : frames.entrySet()) {
            List<Object> channels = new ArrayList<>();
            for (int channel = 0; channel < 2; channel++) {
                List<Object> values = entry.getValue().get(channel);
                if (values.stream().allMatch(frame -> ((List<Number>) ((Map<?, ?>) frame).get("value")).stream().allMatch(number -> number.floatValue() == 0))) continue;
                channels.add(object("target", channel == 0 ? "position" : "rotation", "keyframes", values));
            }
            if (!channels.isEmpty()) bones.put(entry.getKey(), channels);
        }
        if (bones.isEmpty()) throw new IllegalArgumentException("Inputs do not change a named model part");
        return object("length", clip.get("length").getAsDouble(), "loop", clip.get("loop").getAsBoolean(), "bones", bones);
    }

    private static List<Float> delta(ModelPart part, Map<ModelPart, float[]> defaults, int channel) throws Exception {
        List<Float> vector = new ArrayList<>();
        for (int axis = 0; axis < 3; axis++) {
            int index = channel * 3 + axis;
            float delta = ModelPart.class.getField(COMPONENTS[index]).getFloat(part) - defaults.get(part)[index];
            if (!Float.isFinite(delta)) throw new IllegalArgumentException("Nonfinite pose");
            vector.add(delta == 0 ? 0f : delta);
        }
        return vector;
    }

    private static void pose(Object model, Method method, Object entity, Map<ModelPart, float[]> defaults, JsonArray values) throws Exception {
        restore(defaults);
        Object[] arguments = new Object[method.getParameterCount()];
        for (int index = 0; index < arguments.length; index++) {
            if (index == 0 && entity != null) {
                Map<String, Object> state = new TreeMap<>();
                for (var entry : values.get(0).getAsJsonObject().entrySet()) {
                    Method getter = java.util.Arrays.stream(entity.getClass().getMethods()).filter(candidate -> candidate.getName().equals(entry.getKey())).findFirst().orElse(null);
                    if (getter != null) {
                        if (entry.getValue().isJsonObject() && entry.getValue().getAsJsonObject().has("byIndex")) {
                            List<Object> indexed = new ArrayList<>();
                            for (JsonElement item : entry.getValue().getAsJsonObject().getAsJsonArray("byIndex")) indexed.add(value(getter.getReturnType(), item));
                            state.put(entry.getKey(), indexed);
                        } else state.put(entry.getKey(), value(getter.getReturnType(), entry.getValue()));
                    } else {
                        Field field = fields(entity.getClass()).stream().filter(candidate -> candidate.getName().equals(entry.getKey())).findFirst().orElseThrow();
                        field.setAccessible(true);
                        field.set(entity, value(field.getType(), entry.getValue()));
                    }
                }
                entity.getClass().getField("poseInputs").set(entity, state);
                arguments[index] = entity;
            } else arguments[index] = value(method.getParameterTypes()[index], values.get(index));
        }
        if (entity != null && method.getName().equals("setAngles")) {
            float age = ((Number) arguments[3]).floatValue();
            if (!values.get(0).getAsJsonObject().has("age")) entity.getClass().getField("age").setInt(entity, (int) age);
            Method prepare = java.util.Arrays.stream(model.getClass().getMethods()).filter(candidate -> candidate.getName().equals("animateModel") && !candidate.isBridge()).findFirst().orElse(null);
            if (prepare != null) prepare.invoke(model, entity, arguments[1], arguments[2], age - (int) age);
        }
        method.invoke(model, arguments);
    }

    private static Object value(Class<?> type, JsonElement value) throws Exception {
        if (type == float.class) return value.getAsFloat();
        if (type == double.class) return value.getAsDouble();
        if (type == int.class) return value.getAsInt();
        if (type == long.class) return value.getAsLong();
        if (type == boolean.class) return value.getAsBoolean();
        if (type.isEnum()) return type.getField(value.getAsString()).get(null);
        if (type == EntityType.class) return Registry.ENTITY_TYPE.get(new net.minecraft.util.Identifier(value.getAsString()));
        if (type.getName().equals("net.minecraft.util.math.Vec3d")) {
            JsonArray vector = value.getAsJsonArray();
            return type.getConstructor(double.class, double.class, double.class).newInstance(vector.get(0).getAsDouble(), vector.get(1).getAsDouble(), vector.get(2).getAsDouble());
        }
        throw new IllegalArgumentException("Unsupported state value: " + type.getName());
    }

    // Getter-only preview entities avoid creating worlds, loading chunks, or ticking simulation state.
    private static Class<?> previewType(Class<?> model, Class<?> fallback) {
        Class<?> result = fallback;
        for (Class<?> current = model; current != Object.class; current = current.getSuperclass()) {
            List<java.lang.reflect.Type> types = new ArrayList<>();
            for (var parameter : current.getTypeParameters()) types.addAll(List.of(parameter.getBounds()));
            if (current.getGenericSuperclass() instanceof java.lang.reflect.ParameterizedType parent) types.addAll(List.of(parent.getActualTypeArguments()));
            for (var type : types) if (type instanceof Class<?> candidate && result.isAssignableFrom(candidate)) result = candidate;
        }
        return result;
    }

    private static Object entity(Class<?> type) throws Exception {
        Class<?> stub = STUBS.get(type);
        if (stub == null) {
            String name = "LegacyPreview" + STUBS.size();
            Constructor<?> constructor = java.util.Arrays.stream(type.getDeclaredConstructors())
                .filter(value -> !Modifier.isPrivate(value.getModifiers())).min(java.util.Comparator.comparingInt(Constructor::getParameterCount)).orElseThrow();
            String parameters = java.util.Arrays.stream(constructor.getParameterTypes()).map(value -> "(" + value.getCanonicalName() + ")" + defaultValue(value)).collect(java.util.stream.Collectors.joining(","));
            StringBuilder source = new StringBuilder("@SuppressWarnings(\"unchecked\") public class " + name + " extends " + type.getCanonicalName() + " { public java.util.Map<String,Object> poseInputs; public " + name + "(){ super(" + parameters + "); }\n");
            Map<String, Method> methods = new TreeMap<>();
            java.util.Set<String> declared = new java.util.HashSet<>();
            for (Class<?> current = type; current != Object.class; current = current.getSuperclass()) for (Method method : current.getDeclaredMethods()) {
                int modifiers = method.getModifiers();
                if (method.isBridge() || Modifier.isStatic(modifiers) || Modifier.isPrivate(modifiers)) continue;
                if (!Modifier.isPublic(modifiers) && !Modifier.isProtected(modifiers)) continue;
                String key = method.getName() + java.util.Arrays.toString(method.getParameterTypes());
                if (!declared.add(key) || Modifier.isFinal(modifiers) || method.getName().equals("getShakeAnimationProgress")) continue;
                Class<?> result = method.getReturnType();
                boolean getter = (method.getName().matches("(?:get|is|has|can).*?") || method.getName().equals("interpolatePaddlePhase")) && (result.isPrimitive() || result.isEnum()
                    || result == EntityType.class || result == java.util.List.class
                    || result.getName().equals("net.minecraft.util.math.Vec3d") || result.getName().equals("net.minecraft.item.ItemStack"));
                if (!getter && !Modifier.isAbstract(modifiers)) continue;
                methods.putIfAbsent(key, method);
            }
            for (Method method : methods.values()) {
                Class<?> result = method.getReturnType();
                source.append("public ").append(result.getCanonicalName()).append(' ').append(method.getName()).append('(');
                for (int index = 0; index < method.getParameterCount(); index++) {
                    if (index > 0) source.append(',');
                    source.append(method.getParameterTypes()[index].getCanonicalName()).append(" arg").append(index);
                }
                source.append("){");
                if (method.getParameterCount() > 0 && method.getParameterTypes()[0] == int.class && result != void.class)
                    source.append("if(poseInputs!=null && poseInputs.get(\"").append(method.getName()).append("\") instanceof java.util.List values) return (")
                        .append(boxed(result)).append(")values.get(arg0);");
                if (result != void.class) source.append("return poseInputs!=null && poseInputs.containsKey(\"").append(method.getName())
                    .append("\") ? (").append(boxed(result)).append(")poseInputs.get(\"").append(method.getName()).append("\") : ").append(defaultValue(result)).append(';');
                source.append("}\n");
            }
            source.append('}');
            Path file = work.resolve(name + ".java");
            Files.writeString(file, source);
            int status = ToolProvider.getSystemJavaCompiler().run(null, null, null, "-nowarn", "-classpath", System.getProperty("java.class.path"), "-d", work.toString(), file.toString());
            if (status != 0) throw new IllegalArgumentException("Cannot compile preview entity " + type.getName());
            stub = new URLClassLoader(new java.net.URL[]{work.toUri().toURL()}, LegacyModels.class.getClassLoader()).loadClass(name);
            STUBS.put(type, stub);
        }
        return allocate(stub);
    }

    private static Object allocate(Class<?> type) throws Exception {
        Class<?> unsafeType = Class.forName("sun.misc.Unsafe");
        Field singleton = unsafeType.getDeclaredField("theUnsafe");
        singleton.setAccessible(true);
        return unsafeType.getMethod("allocateInstance", Class.class).invoke(singleton.get(null), type);
    }

    private static String boxed(Class<?> type) {
        if (type == boolean.class) return "Boolean";
        if (type == float.class) return "Float";
        if (type == double.class) return "Double";
        if (type == int.class) return "Integer";
        if (type == long.class) return "Long";
        if (type == byte.class) return "Byte";
        if (type == short.class) return "Short";
        if (type == char.class) return "Character";
        return type.getCanonicalName();
    }

    private static String defaultValue(Class<?> type) {
        if (type == boolean.class) return "false";
        if (type.isPrimitive()) return "(" + type.getName() + ")0";
        if (type.getName().equals("net.minecraft.util.math.Vec3d")) return type.getName() + ".ZERO";
        if (type.getName().equals("net.minecraft.item.ItemStack")) return type.getName() + ".EMPTY";
        if (type == java.util.List.class) return "java.util.List.of()";
        if (type.isEnum()) {
            Object[] values = type.getEnumConstants();
            for (String name : List.of("NEUTRAL", "DEFAULT", "RIGHT", "MAIN_HAND", "STANDING")) for (Object value : values)
                if (((Enum<?>) value).name().equals(name)) return type.getCanonicalName() + "." + name;
            return type.getCanonicalName() + "." + ((Enum<?>) values[0]).name();
        }
        return "null";
    }

    private static List<Field> fields(Class<?> type) {
        List<Field> result = new ArrayList<>();
        for (Class<?> current = type; current != Object.class; current = current.getSuperclass()) result.addAll(List.of(current.getDeclaredFields()));
        return result;
    }

    private static Object read(Field field, Object value) throws Exception { field.setAccessible(true); return field.get(value); }
    private static Object field(Object value, String name) throws Exception {
        for (Field field : fields(value.getClass())) if (field.getName().equals(name)) return read(field, value);
        throw new NoSuchFieldException(name);
    }
    private static Map<String, Object> object(Object... entries) {
        Map<String, Object> result = new TreeMap<>();
        for (int index = 0; index < entries.length; index += 2) result.put((String) entries[index], entries[index + 1]);
        return result;
    }
}
