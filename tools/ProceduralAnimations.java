import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.server.Bootstrap;

/** Samples reviewed model inputs and exports part poses relative to their baked defaults. */
public class ProceduralAnimations {
    private static final String[] COMPONENTS = {"x", "y", "z", "xRot", "yRot", "zRot", "xScale", "yScale", "zScale"};
    private static final String[] TARGETS = {"position", "rotation", "scale"};

    public static void main(String[] args) {
        try {
            if (args.length != 2) throw new IllegalArgumentException("Usage: ProceduralAnimations.java <inputs.json> <output.json>");
            SharedConstants.tryDetectVersion();
            Bootstrap.bootStrap();
            Map<String, LayerDefinition> layers = new TreeMap<>();
            for (var entry : LayerDefinitions.createRoots().entrySet()) {
                layers.put(accessor(entry.getKey(), "getModel", "model") + "#" + accessor(entry.getKey(), "getLayer", "layer"), entry.getValue());
            }
            List<Object> result = new ArrayList<>();
            for (JsonElement element : JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonArray()) {
                JsonObject request = element.getAsJsonObject();
                String className = request.get("class").getAsString();
                String layer = request.has("layer") ? request.get("layer").getAsString() : "main";
                for (JsonElement modelId : request.getAsJsonArray("models")) {
                    String id = modelId.getAsString();
                    try {
                        LayerDefinition definition = layers.get(id + "#" + layer);
                        if (definition == null) throw new IllegalArgumentException("Missing layer " + layer);
                        ModelPart root = definition.bakeRoot();
                        Map<String, ModelPart> parts = new TreeMap<>();
                        collect(root, "root", parts);
                        Map<String, float[]> defaults = pose(parts);
                        Class<?> modelClass = Class.forName(className);
                        Object model = model(modelClass, root, request);
                        Class<?>[] parameters = types(request.getAsJsonArray("parameters"));
                        Method method = modelClass.getMethod(request.get("method").getAsString(), parameters);
                        method.setAccessible(true);
                        Map<String, Object> animations = new TreeMap<>();
                        for (var clip : request.getAsJsonObject("clips").entrySet()) {
                            try {
                                animations.put(clip.getKey(), sample(model, method, parts, defaults, clip.getValue().getAsJsonObject()));
                            } catch (Throwable error) {
                                throw new IllegalArgumentException(clip.getKey() + ": " + reason(error), error);
                            }
                        }
                        result.add(object("class", modelClass.getSimpleName(), "modelClasses", List.of(className),
                            "modelIds", List.of(id), "layer", layer, "animations", animations));
                    } catch (Throwable error) {
                        throw new IllegalArgumentException(id + " (" + className + "): " + error.getMessage(), error);
                    }
                }
            }
            Files.writeString(Path.of(args[1]), new GsonBuilder().disableHtmlEscaping().create().toJson(result) + "\n", StandardCharsets.UTF_8);
        } catch (Throwable error) {
            System.err.println("Procedural animation extraction failed: " + error.getMessage());
            System.exit(1);
        }
    }

    private static String reason(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return error.getClass().getSimpleName() + ": " + error.getMessage();
    }

    private static Object model(Class<?> type, ModelPart root, JsonObject request) throws ReflectiveOperationException {
        if (!request.has("constructor")) {
            Constructor<?> constructor = type.getDeclaredConstructor(ModelPart.class);
            constructor.setAccessible(true);
            return constructor.newInstance(root);
        }
        JsonObject extra = request.getAsJsonObject("constructor");
        Class<?>[] additional = types(extra.getAsJsonArray("parameters"));
        Class<?>[] parameters = new Class<?>[additional.length + 1];
        parameters[0] = ModelPart.class;
        System.arraycopy(additional, 0, parameters, 1, additional.length);
        Object[] values = new Object[parameters.length];
        values[0] = root;
        System.arraycopy(arguments(additional, extra.getAsJsonArray("values")), 0, values, 1, additional.length);
        Constructor<?> constructor = type.getDeclaredConstructor(parameters);
        constructor.setAccessible(true);
        return constructor.newInstance(values);
    }

    private static Map<String, Object> sample(Object model, Method method, Map<String, ModelPart> parts,
            Map<String, float[]> defaults, JsonObject clip) throws ReflectiveOperationException {
        Map<String, List<List<Map<String, Object>>>> frames = new TreeMap<>();
        for (String bone : parts.keySet()) frames.put(bone, List.of(new ArrayList<>(), new ArrayList<>(), new ArrayList<>()));
        for (JsonElement element : clip.getAsJsonArray("frames")) {
            JsonObject frame = element.getAsJsonObject();
            Map<String, float[]> before = frame.has("pre") ? evaluate(model, method, parts, defaults, frame.getAsJsonArray("pre")) : null;
            Map<String, float[]> after = evaluate(model, method, parts, defaults, frame.getAsJsonArray("values"));
            for (String bone : parts.keySet()) {
                for (int channel = 0; channel < TARGETS.length; channel++) {
                    List<Float> value = vector(after.get(bone), defaults.get(bone), channel);
                    Map<String, Object> keyframe = object("time", frame.get("time").getAsDouble(), "value", value, "interpolation", "linear");
                    if (before != null) {
                        List<Float> pre = vector(before.get(bone), defaults.get(bone), channel);
                        if (!pre.equals(value)) keyframe.put("pre", pre);
                    }
                    frames.get(bone).get(channel).add(keyframe);
                }
            }
        }
        Map<String, Object> bones = new TreeMap<>();
        for (var bone : frames.entrySet()) {
            List<Object> channels = new ArrayList<>();
            for (int channel = 0; channel < TARGETS.length; channel++) {
                List<Map<String, Object>> keyframes = bone.getValue().get(channel);
                if (keyframes.stream().allMatch(frame -> zero(frame.get("value")) && (!frame.containsKey("pre") || zero(frame.get("pre"))))) continue;
                Object first = keyframes.get(0).get("value");
                if (keyframes.stream().allMatch(frame -> first.equals(frame.get("value")) && !frame.containsKey("pre"))) {
                    keyframes = List.of(keyframes.get(0));
                }
                channels.add(object("target", TARGETS[channel], "keyframes", keyframes));
            }
            if (!channels.isEmpty()) bones.put(bone.getKey(), channels);
        }
        if (bones.isEmpty()) throw new IllegalArgumentException("Inputs do not change any model part");
        return object("length", clip.get("length").getAsDouble(), "loop", clip.get("loop").getAsBoolean(), "bones", bones);
    }

    private static Map<String, float[]> evaluate(Object model, Method method, Map<String, ModelPart> parts,
            Map<String, float[]> defaults, JsonArray values) throws ReflectiveOperationException {
        for (var entry : parts.entrySet()) {
            float[] pose = defaults.get(entry.getKey());
            for (int index = 0; index < COMPONENTS.length; index++) ModelPart.class.getField(COMPONENTS[index]).setFloat(entry.getValue(), pose[index]);
        }
        method.invoke(model, arguments(method.getParameterTypes(), values));
        return pose(parts);
    }

    private static List<Float> vector(float[] pose, float[] defaults, int channel) {
        List<Float> result = new ArrayList<>();
        for (int index = channel * 3; index < channel * 3 + 3; index++) {
            float value = pose[index] - defaults[index];
            if (!Float.isFinite(value)) throw new IllegalArgumentException("Nonfinite model pose");
            result.add(value == 0 ? 0f : value);
        }
        return result;
    }

    private static boolean zero(Object value) {
        return ((List<?>) value).stream().allMatch(number -> ((Number) number).floatValue() == 0);
    }

    private static Map<String, float[]> pose(Map<String, ModelPart> parts) throws ReflectiveOperationException {
        Map<String, float[]> result = new TreeMap<>();
        for (var entry : parts.entrySet()) {
            float[] values = new float[COMPONENTS.length];
            for (int index = 0; index < COMPONENTS.length; index++) values[index] = ModelPart.class.getField(COMPONENTS[index]).getFloat(entry.getValue());
            result.put(entry.getKey(), values);
        }
        return result;
    }

    private static void collect(ModelPart part, String name, Map<String, ModelPart> parts) throws ReflectiveOperationException {
        if (parts.put(name, part) != null) throw new IllegalArgumentException("Ambiguous bone name: " + name);
        Field field = ModelPart.class.getDeclaredField("children");
        field.setAccessible(true);
        for (var entry : ((Map<?, ?>) field.get(part)).entrySet()) collect((ModelPart) entry.getValue(), entry.getKey().toString(), parts);
    }

    private static Class<?>[] types(JsonArray names) throws ClassNotFoundException {
        Class<?>[] result = new Class<?>[names.size()];
        for (int index = 0; index < result.length; index++) {
            result[index] = switch (names.get(index).getAsString()) {
                case "float" -> float.class;
                case "int" -> int.class;
                case "boolean" -> boolean.class;
                default -> Class.forName(names.get(index).getAsString());
            };
        }
        return result;
    }

    private static Object[] arguments(Class<?>[] types, JsonArray values) throws ReflectiveOperationException {
        if (types.length != values.size()) throw new IllegalArgumentException("Wrong argument count");
        Object[] result = new Object[types.length];
        for (int index = 0; index < types.length; index++) result[index] = convert(types[index], values.get(index));
        return result;
    }

    private static Object convert(Class<?> type, JsonElement value) throws ReflectiveOperationException {
        if (value.isJsonNull()) return null;
        if (type == float.class || type == Float.class) return value.getAsFloat();
        if (type == int.class || type == Integer.class) return value.getAsInt();
        if (type == boolean.class || type == Boolean.class) return value.getAsBoolean();
        if (type.isEnum()) return type.getField(value.getAsString()).get(null);
        JsonObject fields = value.getAsJsonObject();
        if (type.isRecord()) {
            var components = type.getRecordComponents();
            Class<?>[] parameters = Arrays.stream(components).map(component -> component.getType()).toArray(Class<?>[]::new);
            Object[] values = new Object[components.length];
            for (int index = 0; index < values.length; index++) values[index] = convert(parameters[index], fields.get(components[index].getName()));
            Constructor<?> constructor = type.getDeclaredConstructor(parameters);
            constructor.setAccessible(true);
            return constructor.newInstance(values);
        }
        Object result = type.getConstructor().newInstance();
        for (var entry : fields.entrySet()) {
            Field field = type.getField(entry.getKey());
            field.set(result, convert(field.getType(), entry.getValue()));
        }
        return result;
    }

    private static Object accessor(Object value, String... names) throws ReflectiveOperationException {
        for (String name : names) {
            try { return value.getClass().getMethod(name).invoke(value); } catch (NoSuchMethodException error) { }
        }
        throw new NoSuchMethodException(value.getClass().getName());
    }

    private static Map<String, Object> object(Object... entries) {
        Map<String, Object> result = new TreeMap<>();
        for (int index = 0; index < entries.length; index += 2) result.put((String) entries[index], entries[index + 1]);
        return result;
    }
}
