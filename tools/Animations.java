import com.google.gson.GsonBuilder;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.server.Bootstrap;

/** Dumps the keyframe animation definitions (1.19+) and the model IDs whose model class uses them. */
public class Animations {
    private static final String DEFINITION = "net.minecraft.client.animation.AnimationDefinition";
    private static final String DEFINITIONS = "net/minecraft/client/animation/definitions/";
    private static final String CLIENT = "net/minecraft/client/";
    private static final String MODELS = "net/minecraft/client/model/";
    private static final String LAYERS = "net/minecraft/client/model/geom/ModelLayers";
    private static final Map<Object, String> CONSTANTS = new IdentityHashMap<>();

    public static void main(String[] args) {
        try {
            if (args.length != 1) {
                throw new IllegalArgumentException("Usage: Animations.java <output.json>");
            }
            List<Object> result = new ArrayList<>();
            Class<?> definition = null;
            try {
                definition = Class.forName(DEFINITION);
            } catch (ClassNotFoundException error) {
            }
            if (definition != null) {
                SharedConstants.tryDetectVersion();
                Bootstrap.bootStrap();
                for (Class<?> holder : Class.forName("net.minecraft.client.animation.AnimationChannel").getDeclaredClasses()) {
                    for (Field field : holder.getDeclaredFields()) {
                        if (!Modifier.isStatic(field.getModifiers()) || field.isSynthetic()) continue;
                        field.setAccessible(true);
                        CONSTANTS.put(field.get(null), field.getName().toLowerCase(Locale.ROOT));
                    }
                }
                Map<String, ModelPart> roots = new TreeMap<>();
                for (var entry : LayerDefinitions.createRoots().entrySet()) {
                    if (accessor(entry.getKey(), "getLayer", "layer").toString().equals("main")) {
                        roots.put(accessor(entry.getKey(), "getModel", "model").toString(), entry.getValue().bakeRoot());
                    }
                }
                // ModelLayers constant name → model ID, for main layers.
                Map<String, String> layerFields = new TreeMap<>();
                for (Field field : ModelLayers.class.getFields()) {
                    if (field.getType() != ModelLayerLocation.class) continue;
                    Object location = field.get(null);
                    if (accessor(location, "getLayer", "layer").toString().equals("main")) {
                        layerFields.put(field.getName(), accessor(location, "getModel", "model").toString());
                    }
                }
                // Class file bytes per top-level client class (nested classes appended), searched for constant pool names.
                Map<String, String> sources = new TreeMap<>();
                TreeSet<String> classes = new TreeSet<>();
                try (ZipFile jar = new ZipFile(Path.of(definition.getProtectionDomain().getCodeSource().getLocation().toURI()).toFile())) {
                    for (ZipEntry entry : jar.stream().toList()) {
                        String name = entry.getName();
                        if (!name.startsWith(CLIENT) || !name.endsWith(".class") || name.endsWith("package-info.class")) continue;
                        name = name.substring(0, name.length() - 6);
                        if (name.startsWith(DEFINITIONS) && !name.contains("$")) classes.add(name.substring(DEFINITIONS.length()));
                        sources.merge(name.replaceAll("\\$.*", ""),
                            new String(jar.getInputStream(entry).readAllBytes(), StandardCharsets.ISO_8859_1), String::concat);
                    }
                }
                ClassLoader loader = Animations.class.getClassLoader();
                for (String simpleName : classes) {
                    Map<String, Object> animations = new TreeMap<>();
                    for (Field field : Class.forName((DEFINITIONS + simpleName).replace('/', '.')).getDeclaredFields()) {
                        if (!Modifier.isStatic(field.getModifiers()) || field.getType() != definition) continue;
                        field.setAccessible(true);
                        animations.put(field.getName(), animation(field.get(null)));
                    }
                    // Model classes that name the definition class, and their subclasses.
                    TreeSet<String> users = new TreeSet<>();
                    for (String owner : sources.keySet()) {
                        if (!owner.startsWith(MODELS)) continue;
                        for (Class<?> type = Class.forName(owner.replace('/', '.'), false, loader); type != null; type = type.getSuperclass()) {
                            String source = sources.get(type.getName().replace('.', '/'));
                            if (source != null && references(source, DEFINITIONS + simpleName)) users.add(owner);
                        }
                    }
                    // A model ID belongs to a model class when some class outside model/geom (LayerDefinitions names
                    // every model class and layer) names both the model class and the ModelLayers constant of the ID's
                    // main layer, and the model class accepts that baked layer. Where no class does (1.20.1 passes
                    // the camel layer to its renderer from EntityRenderers), the classes naming such a class count too.
                    TreeSet<String> ids = new TreeSet<>();
                    for (int hops = 0; hops < 2 && ids.isEmpty(); hops++) {
                        for (String user : users) {
                            Class<?> model = Class.forName(user.replace('/', '.'), false, loader);
                            TreeSet<String> namers = namers(sources, List.of(user));
                            if (hops == 1) namers.addAll(namers(sources, List.copyOf(namers)));
                            for (String namer : namers) {
                                String source = sources.get(namer);
                                if (!references(source, LAYERS)) continue;
                                for (var layer : layerFields.entrySet()) {
                                    String constant = "\u0001" + (char) (layer.getKey().length() >> 8) + (char) (layer.getKey().length() & 255) + layer.getKey();
                                    if (references(source, constant) && roots.containsKey(layer.getValue())
                                            && constructible(model, roots.get(layer.getValue()))) {
                                        ids.add(layer.getValue());
                                    }
                                }
                            }
                        }
                    }
                    List<String> names = new ArrayList<>();
                    for (String user : users) names.add(user.replace('/', '.'));
                    result.add(object("class", simpleName, "animations", animations, "modelClasses", names, "modelIds", ids));
                }
            }
            Files.writeString(Path.of(args[0]), new GsonBuilder().disableHtmlEscaping().create().toJson(result) + "\n", StandardCharsets.UTF_8);
        } catch (Throwable error) {
            while (error.getCause() != null) {
                error = error.getCause();
            }
            System.err.println("Animation extraction failed: " + error.getClass().getSimpleName() + ": " + error.getMessage());
            System.exit(1);
        }
    }

    /** Whether class file bytes contain the name exactly (the next byte starts another constant or ends a descriptor). */
    private static boolean references(String bytes, String name) {
        for (int index = bytes.indexOf(name); index >= 0; index = bytes.indexOf(name, index + 1)) {
            int end = index + name.length();
            if (end == bytes.length() || bytes.charAt(end) < ' ' || bytes.charAt(end) == ';') return true;
        }
        return false;
    }

    private static TreeSet<String> namers(Map<String, String> sources, List<String> names) {
        TreeSet<String> result = new TreeSet<>();
        for (var entry : sources.entrySet()) {
            if (entry.getKey().startsWith(MODELS + "geom/")) continue;
            for (String name : names) {
                if (references(entry.getValue(), name)) result.add(entry.getKey());
            }
        }
        return result;
    }

    private static boolean constructible(Class<?> model, ModelPart root) {
        for (Constructor<?> constructor : model.getDeclaredConstructors()) {
            if (constructor.getParameterCount() != 1 || constructor.getParameterTypes()[0] != ModelPart.class
                    || Modifier.isAbstract(model.getModifiers())) continue;
            try {
                constructor.setAccessible(true);
                constructor.newInstance(root);
                return true;
            } catch (Throwable error) {
            }
        }
        return false;
    }

    private static Map<String, Object> animation(Object definition) throws ReflectiveOperationException {
        Map<String, Object> result = new TreeMap<>();
        for (Field field : instanceFields(definition)) {
            Object value = field.get(definition);
            if (field.getType() == float.class) {
                result.put("length", value);
            } else if (field.getType() == boolean.class) {
                result.put("loop", value);
            } else if (value instanceof Map<?, ?> bones) {
                Map<String, Object> channels = new TreeMap<>();
                for (var entry : bones.entrySet()) {
                    List<Object> list = new ArrayList<>();
                    for (Object channel : (List<?>) entry.getValue()) {
                        list.add(channel(channel));
                    }
                    channels.put((String) entry.getKey(), list);
                }
                result.put("bones", channels);
            }
        }
        return result;
    }

    private static Map<String, Object> channel(Object channel) throws ReflectiveOperationException {
        Map<String, Object> result = new TreeMap<>();
        for (Field field : instanceFields(channel)) {
            Object value = field.get(channel);
            if (value instanceof Object[] keyframes) {
                List<Object> list = new ArrayList<>();
                for (Object keyframe : keyframes) {
                    list.add(keyframe(keyframe));
                }
                result.put("keyframes", list);
            } else {
                result.put("target", constant(value));
            }
        }
        return result;
    }

    private static Map<String, Object> keyframe(Object keyframe) throws ReflectiveOperationException {
        Map<String, Object> result = new TreeMap<>();
        List<Object> vectors = new ArrayList<>();
        for (Field field : instanceFields(keyframe)) {
            Object value = field.get(keyframe);
            if (field.getType() == float.class) {
                result.put("time", value);
            } else if (CONSTANTS.containsKey(value)) {
                result.put("interpolation", constant(value));
            } else {
                vectors.add(List.of(accessor(value, "x"), accessor(value, "y"), accessor(value, "z")));
            }
        }
        // 1.20.1 has one target; 1.21.11 has the value to arrive at and the value to leave from.
        result.put("value", vectors.get(vectors.size() - 1));
        if (!vectors.get(0).equals(vectors.get(vectors.size() - 1))) {
            result.put("pre", vectors.get(0));
        }
        return result;
    }

    private static String constant(Object value) {
        String name = CONSTANTS.get(value);
        if (name == null) throw new IllegalArgumentException("Unknown animation target or interpolation: " + value);
        return name;
    }

    private static List<Field> instanceFields(Object value) {
        List<Field> fields = new ArrayList<>();
        for (Field field : value.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers())) continue;
            field.setAccessible(true);
            fields.add(field);
        }
        return fields;
    }

    private static Object accessor(Object value, String... names) throws ReflectiveOperationException {
        for (String name : names) {
            try {
                var method = value.getClass().getMethod(name);
                method.setAccessible(true);
                return method.invoke(value);
            } catch (NoSuchMethodException error) {
                continue;
            }
        }
        throw new NoSuchMethodException(value.getClass().getName() + "." + String.join("/", names));
    }

    private static Map<String, Object> object(Object... entries) {
        Map<String, Object> result = new TreeMap<>();
        for (int index = 0; index < entries.length; index += 2) {
            result.put((String) entries[index], entries[index + 1]);
        }
        return result;
    }
}
