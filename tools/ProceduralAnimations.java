import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import javax.tools.ToolProvider;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.server.Bootstrap;

/** Samples reviewed model inputs and exports part poses relative to their baked defaults. */
@SuppressWarnings("deprecation")
public class ProceduralAnimations {
    private static final String[] COMPONENTS = {"x", "y", "z", "xRot", "yRot", "zRot", "xScale", "yScale", "zScale"};
    private static final String[] TARGETS = {"position", "rotation", "scale"};
    private static final Map<String, Class<?>> FIXTURES = new TreeMap<>();
    private static final Map<String, Object> RETAINED_FIXTURES = new TreeMap<>();
    private static boolean retainFixtures;
    private static Path fixtureDirectory;

    public static void main(String[] args) {
        int status = 0;
        try {
            if (args.length != 2) throw new IllegalArgumentException("Usage: ProceduralAnimations.java <inputs.json> <output.json>");
            SharedConstants.tryDetectVersion();
            Bootstrap.bootStrap();
            Map<String, LayerDefinition> layers = new TreeMap<>();
            for (var entry : LayerDefinitions.createRoots().entrySet()) {
                layers.put(accessor(entry.getKey(), "getModel", "model") + "#" + accessor(entry.getKey(), "getLayer", "layer"), entry.getValue());
            }
            List<Object> result = new ArrayList<>();
            for (JsonElement element : new JsonParser().parse(Files.readString(Path.of(args[0]))).getAsJsonArray()) {
                JsonObject request = element.getAsJsonObject();
                String className = request.get("class").getAsString();
                String layer = request.has("layer") ? request.get("layer").getAsString() : "main";
                for (JsonElement modelId : request.getAsJsonArray("models")) {
                    String id = modelId.getAsString();
                    try {
                        JsonObject modelLayer = request.has("modelLayer") ? request.getAsJsonObject("modelLayer") : null;
                        String source = modelLayer == null ? id + "#" + layer
                            : modelLayer.get("model").getAsString() + "#" + modelLayer.get("layer").getAsString();
                        LayerDefinition definition = layers.get(source);
                        if (definition == null) throw new IllegalArgumentException("Missing layer " + layer);
                        ModelPart root = definition.bakeRoot();
                        Map<String, ModelPart> parts = new TreeMap<>();
                        collect(root, "root", parts);
                        if (modelLayer != null && modelLayer.has("poses")) applyPoses(parts, modelLayer.getAsJsonObject("poses"));
                        Map<String, float[]> defaults = pose(parts);
                        Class<?> modelClass = Class.forName(className);
                        Object model = request.has("poses") ? null : model(modelClass, root, request);
                        Method method = request.has("poses") ? null : method(modelClass,
                            request.get("method").getAsString(), types(request.getAsJsonArray("parameters")));
                        Map<String, Object> animations = new TreeMap<>();
                        for (var clip : request.getAsJsonObject("clips").entrySet()) {
                            try {
                                animations.put(clip.getKey(), sample(model, method, parts, defaults, clip.getValue().getAsJsonObject(), request));
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
            status = 1;
        } finally {
            if (fixtureDirectory != null) {
                try (var files = Files.walk(fixtureDirectory)) {
                    for (Path file : files.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
                } catch (Exception error) { System.err.println("Cannot remove animation fixture files: " + error.getMessage()); }
            }
        }
        if (status != 0) System.exit(status);
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
            Map<String, float[]> defaults, JsonObject clip, JsonObject request) throws ReflectiveOperationException {
        retainFixtures = request.has("continuous");
        RETAINED_FIXTURES.clear();
        if (retainFixtures) {
            restore(parts, defaults);
            model = model(model.getClass(), parts.get("root"), request);
        }
        Map<String, List<List<Map<String, Object>>>> frames = new TreeMap<>();
        for (String bone : parts.keySet()) frames.put(bone, List.of(new ArrayList<>(), new ArrayList<>(), new ArrayList<>()));
        for (JsonElement element : clip.getAsJsonArray("frames")) {
            JsonObject frame = element.getAsJsonObject();
            Map<String, float[]> before = frame.has("pre") ? evaluate(model, method, parts, defaults, frame.getAsJsonArray("pre"), request) : null;
            Map<String, float[]> after = evaluate(model, method, parts, defaults, frame.getAsJsonArray("values"), request);
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
            Map<String, float[]> defaults, JsonArray values, JsonObject request) throws ReflectiveOperationException {
        if (!request.has("continuous")) restore(parts, defaults);
        if (method == null) {
            applyPoses(parts, values.get(0).getAsJsonObject());
        } else {
            if (request.has("resetModel") && !request.has("continuous")) model = model(model.getClass(), parts.get("root"), request);
            if (request.has("fields")) for (var entry : request.getAsJsonObject("fields").entrySet()) {
                Field field = model.getClass().getField(entry.getKey());
                field.set(model, convert(field.getType(), entry.getValue()));
            }
            Object[] arguments = arguments(method.getParameterTypes(), values);
            if (request.has("prepare")) {
                JsonObject prepare = request.getAsJsonObject("prepare");
                Method preparation = method(model.getClass(), prepare.get("method").getAsString(), types(prepare.getAsJsonArray("parameters")));
                Object[] inputs = new Object[prepare.getAsJsonArray("arguments").size()];
                for (int index = 0; index < inputs.length; index++) {
                    JsonElement argument = prepare.getAsJsonArray("arguments").get(index);
                    inputs[index] = argument.isJsonObject()
                        ? convert(preparation.getParameterTypes()[index], argument.getAsJsonObject().get("value"))
                        : arguments[argument.getAsInt()];
                }
                preparation.invoke(model, inputs);
            }
            if (request.has("cameraIndependent")) {
                Class<?> minecraft = Class.forName("net.minecraft.client.Minecraft");
                Field instance = field(minecraft, "instance");
                Object previous = instance.get(null);
                try {
                    instance.set(null, allocate(minecraft));
                    method.invoke(model, arguments);
                } finally { instance.set(null, previous); }
            } else method.invoke(model, arguments);
        }
        return pose(parts);
    }

    private static void restore(Map<String, ModelPart> parts, Map<String, float[]> defaults) throws ReflectiveOperationException {
        for (var entry : parts.entrySet()) {
            float[] pose = defaults.get(entry.getKey());
            for (int index = 0; index < COMPONENTS.length; index++) {
                Field component = component(index);
                if (component != null) component.setFloat(entry.getValue(), pose[index]);
            }
        }
    }

    private static void applyPoses(Map<String, ModelPart> parts, JsonObject poses) throws ReflectiveOperationException {
        for (var bone : poses.entrySet()) {
            ModelPart part = parts.get(bone.getKey());
            if (part == null) throw new IllegalArgumentException("Missing posed part " + bone.getKey());
            for (var value : bone.getValue().getAsJsonObject().entrySet()) {
                ModelPart.class.getField(value.getKey()).setFloat(part, value.getValue().getAsFloat());
            }
        }
    }

    private static Field component(int index) throws NoSuchFieldException {
        try { return ModelPart.class.getField(COMPONENTS[index]); }
        catch (NoSuchFieldException error) {
            if (index < 6) throw error;
            return null;
        }
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
            for (int index = 0; index < COMPONENTS.length; index++) {
                Field component = component(index);
                values[index] = component == null ? 1 : component.getFloat(entry.getValue());
            }
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
                case "double" -> double.class;
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
        if (type == double.class || type == Double.class) return value.getAsDouble();
        if (type == boolean.class || type == Boolean.class) return value.getAsBoolean();
        if (type.isEnum()) return type.getField(value.getAsString()).get(null);
        JsonObject fields = value.getAsJsonObject();
        if (fields.has("$factory")) {
            JsonObject factory = fields.getAsJsonObject("$factory");
            Class<?>[] parameters = types(factory.getAsJsonArray("parameters"));
            return method(type, factory.get("method").getAsString(), parameters).invoke(null,
                arguments(parameters, factory.getAsJsonArray("values")));
        }
        if (fields.has("$static")) {
            String name = fields.get("$static").getAsString();
            int dot = name.lastIndexOf('.');
            return Class.forName(name.substring(0, dot)).getField(name.substring(dot + 1)).get(null);
        }
        if (fields.has("$entity")) return fixture(fields);
        if (fields.has("$new")) return Class.forName(fields.get("$new").getAsString()).getConstructor().newInstance();
        if (fields.has("$constructor")) {
            JsonObject constructor = fields.getAsJsonObject("$constructor");
            Class<?>[] parameters = types(constructor.getAsJsonArray("parameters"));
            return type.getConstructor(parameters).newInstance(arguments(parameters, constructor.getAsJsonArray("values")));
        }
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

    private static Method method(Class<?> type, String name, Class<?>[] parameters) throws NoSuchMethodException {
        for (Class<?> parent = type; parent != null; parent = parent.getSuperclass()) {
            try {
                Method result = parent.getDeclaredMethod(name, parameters);
                result.setAccessible(true);
                return result;
            } catch (NoSuchMethodException error) { }
        }
        throw new NoSuchMethodException(type.getName() + "." + name);
    }

    // Classic models read entity getters instead of render-state fields. Fixtures supply reviewed
    // getter results without constructing a world or running an entity's simulation.
    private static Object fixture(JsonObject input) throws ReflectiveOperationException {
        Class<?> parent = Class.forName(input.get("$entity").getAsString());
        JsonObject getters = input.getAsJsonObject("getters");
        List<String> getterNames = getters.entrySet().stream().map(Map.Entry::getKey).toList();
        String key = parent.getName() + getterNames.toString();
        Class<?> type = FIXTURES.get(key);
        if (type == null) {
            String name = "AnimationEntity" + FIXTURES.size();
            StringBuilder source = new StringBuilder("@SuppressWarnings({\"unchecked\",\"rawtypes\"}) public class " + name + " extends " + parent.getCanonicalName() + " {\n");
            Constructor<?> constructor = Arrays.stream(parent.getDeclaredConstructors())
                .filter(candidate -> !Modifier.isPrivate(candidate.getModifiers())).findFirst().orElseThrow();
            source.append("public ").append(name).append("() throws Throwable { super(");
            source.append(String.join(",", Arrays.stream(constructor.getParameterTypes()).map(parameter ->
                parameter.isPrimitive() ? parameter == boolean.class ? "false" : "0" : "(" + parameter.getCanonicalName() + ")null").toList()));
            source.append("); }\n");
            int index = 0;
            for (String getter : getterNames) {
                Method target = getter(parent, getter);
                String result = target.getReturnType().getCanonicalName();
                boolean indexed = getters.get(getter).isJsonArray();
                source.append("public ").append(result).append(indexed ? "[]" : "").append(" input").append(index).append(";\n");
                source.append("@Override public ").append(result).append(" ").append(target.getName()).append("(");
                List<String> parameters = new ArrayList<>();
                for (int argument = 0; argument < target.getParameterCount(); argument++) {
                    parameters.add(target.getParameterTypes()[argument].getCanonicalName() + " p" + argument);
                }
                source.append(String.join(",", parameters)).append(") { return input").append(index++)
                    .append(indexed ? "[p0]" : "").append("; }\n");
            }
            source.append("}\n");
            try {
                if (fixtureDirectory == null) fixtureDirectory = Files.createTempDirectory("minecraft-animation-entities-");
                Path file = fixtureDirectory.resolve(name + ".java");
                Files.writeString(file, source);
                int result = ToolProvider.getSystemJavaCompiler().run(null, null, null, "-proc:none", "-Xlint:none", "-nowarn", "-classpath",
                    System.getProperty("java.class.path"), "-d", fixtureDirectory.toString(), file.toString());
                if (result != 0) throw new IllegalArgumentException("Cannot compile entity fixture for " + parent.getName());
                type = Class.forName(name, true, new URLClassLoader(new java.net.URL[] {fixtureDirectory.toUri().toURL()}, parent.getClassLoader()));
                FIXTURES.put(key, type);
            } catch (java.io.IOException error) { throw new IllegalArgumentException(error); }
        }
        Object result = retainFixtures ? RETAINED_FIXTURES.get(key) : null;
        boolean retained = result != null;
        if (result == null) result = allocate(type);
        if (retainFixtures) RETAINED_FIXTURES.put(key, result);
        int index = 0;
        for (var getter : getters.entrySet()) {
            Field field = type.getField("input" + index++);
            if (field.getType().isArray()) {
                JsonArray values = getter.getValue().getAsJsonArray();
                Class<?> element = field.getType().getComponentType();
                Object array = java.lang.reflect.Array.newInstance(element, values.size());
                for (int i = 0; i < values.size(); i++) java.lang.reflect.Array.set(array, i, convert(element, values.get(i)));
                field.set(result, array);
            } else if (!(retained && getter.getValue().isJsonObject() && getter.getValue().getAsJsonObject().has("$new"))) {
                field.set(result, convert(field.getType(), getter.getValue()));
            }
        }
        if (input.has("fields")) for (var entry : input.getAsJsonObject("fields").entrySet()) {
            Field field = field(parent, entry.getKey());
            field.set(result, convert(field.getType(), entry.getValue()));
        }
        return result;
    }

    private static Object allocate(Class<?> type) throws ReflectiveOperationException {
        Field unsafeField = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
        unsafeField.setAccessible(true);
        return ((sun.misc.Unsafe) unsafeField.get(null)).allocateInstance(type);
    }

    private static Field field(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> parent = type; parent != null; parent = parent.getSuperclass()) {
            try {
                Field field = parent.getDeclaredField(name);
                field.setAccessible(true);
                return field;
            } catch (NoSuchFieldException error) { }
        }
        throw new NoSuchFieldException(type.getName() + "." + name);
    }

    private static Method getter(Class<?> type, String signature) throws ReflectiveOperationException {
        int bracket = signature.indexOf('(');
        if (bracket < 0) return type.getMethod(signature);
        JsonArray parameters = new JsonArray();
        for (String name : signature.substring(bracket + 1, signature.length() - 1).split(",")) {
            if (!name.isEmpty()) parameters.add(name);
        }
        return type.getMethod(signature.substring(0, bracket), types(parameters));
    }

    private static Map<String, Object> object(Object... entries) {
        Map<String, Object> result = new TreeMap<>();
        for (int index = 0; index < entries.length; index += 2) result.put((String) entries[index], entries[index + 1]);
        return result;
    }
}
