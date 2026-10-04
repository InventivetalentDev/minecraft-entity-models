import com.google.gson.GsonBuilder;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.model.geom.builders.UVPair;
import net.minecraft.core.Registry;
import net.minecraft.server.Bootstrap;

public class Extract {
    public static void main(String[] args) {
        try {
            if (args.length != 1) {
                throw new IllegalArgumentException("Usage: Extract.java <output.json>");
            }
            SharedConstants.tryDetectVersion();
            Bootstrap.bootStrap();
            Set<String> blockEntities = blockEntities();
            Map<String, Map<String, Object>> models = new TreeMap<>();
            Map<ModelLayerLocation, LayerDefinition> roots = LayerDefinitions.createRoots();
            for (var entry : roots.entrySet()) {
                String id = accessor(entry.getKey(), "getModel", "model").toString();
                String name = accessor(entry.getKey(), "getLayer", "layer").toString();
                Map<String, Object> layers = models.computeIfAbsent(id, ignored -> new TreeMap<>());
                if (layers.put(name, layer(entry.getValue())) != null) {
                    throw new IllegalArgumentException("Duplicate model layer: " + id + "#" + name);
                }
            }
            List<Object> result = new ArrayList<>();
            for (var entry : models.entrySet()) {
                String id = entry.getKey();
                result.add(object("kind", blockEntities.contains(id) ? "block_entity" : "entity",
                    "model", object("id", id, "layers", entry.getValue())));
            }
            String json = new GsonBuilder().disableHtmlEscaping().create().toJson(result);
            Files.writeString(Path.of(args[0]), json + "\n", StandardCharsets.UTF_8);
        } catch (Throwable error) {
            while (error.getCause() != null) {
                error = error.getCause();
            }
            System.err.println("Extraction failed: " + error.getClass().getSimpleName() + ": " + error.getMessage());
            System.exit(1);
        }
    }

    private static Set<String> blockEntities() throws ReflectiveOperationException {
        Class<?> registries;
        try {
            registries = Class.forName("net.minecraft.core.registries.BuiltInRegistries");
        } catch (ClassNotFoundException error) {
            registries = Registry.class;
        }
        Registry<?> registry = (Registry<?>) registries.getField("BLOCK_ENTITY_TYPE").get(null);
        Set<String> result = new HashSet<>();
        for (Object id : registry.keySet()) {
            result.add(id.toString());
        }
        return result;
    }

    private static Map<String, Object> layer(LayerDefinition definition) throws ReflectiveOperationException {
        MeshDefinition mesh = (MeshDefinition) field(definition, "mesh");
        Object material = field(definition, "material");
        return object("texture", List.of(field(material, "xTexSize"), field(material, "yTexSize")),
            "root", part(mesh.getRoot()));
    }

    private static Map<String, Object> part(PartDefinition definition) throws ReflectiveOperationException {
        Object pose = field(definition, "partPose");
        Map<String, Object> poseData = object("offset", coordinates(pose, "x", "y", "z"),
            "rotation", coordinates(pose, "xRot", "yRot", "zRot"));
        try {
            List<Number> scale = coordinates(pose, "xScale", "yScale", "zScale");
            if (scale.stream().anyMatch(number -> number.floatValue() != 1)) {
                poseData.put("scale", scale);
            }
        } catch (NoSuchFieldException error) {
        }
        List<Object> cubes = new ArrayList<>();
        for (Object cube : (List<?>) field(definition, "cubes")) {
            cubes.add(cube(cube));
        }
        Map<String, Object> children = new TreeMap<>();
        for (var entry : children(definition)) {
            children.put(entry.getKey(), part(entry.getValue()));
        }
        return object("pose", poseData, "cubes", cubes, "children", children);
    }

    @SuppressWarnings("unchecked")
    private static Collection<Map.Entry<String, PartDefinition>> children(PartDefinition definition)
            throws ReflectiveOperationException {
        try {
            Method getter = PartDefinition.class.getMethod("getChildren");
            return (Collection<Map.Entry<String, PartDefinition>>) getter.invoke(definition);
        } catch (NoSuchMethodException error) {
            return ((Map<String, PartDefinition>) field(definition, "children")).entrySet();
        }
    }

    private static Map<String, Object> cube(Object cube) throws ReflectiveOperationException {
        UVPair uv = (UVPair) field(cube, "texCoord");
        Map<String, Object> result = object(
            "origin", coordinates(field(cube, "origin"), "x", "y", "z"),
            "size", coordinates(field(cube, "dimensions"), "x", "y", "z"),
            "uv", List.of(uv.u(), uv.v()));
        List<Number> grow = coordinates(field(cube, "grow"), "growX", "growY", "growZ");
        if (grow.stream().anyMatch(number -> number.floatValue() != 0)) {
            result.put("grow", grow);
        }
        if ((boolean) field(cube, "mirror")) {
            result.put("mirror", true);
        }
        return result;
    }

    private static List<Number> coordinates(Object value, String x, String y, String z)
            throws ReflectiveOperationException {
        return List.of(number(value, x), number(value, y), number(value, z));
    }

    private static Number number(Object value, String name) throws ReflectiveOperationException {
        try {
            return (Number) value.getClass().getMethod(name).invoke(value);
        } catch (NoSuchMethodException error) {
            return (Number) field(value, name);
        }
    }

    private static Object accessor(Object value, String... names) throws ReflectiveOperationException {
        for (String name : names) {
            try {
                return value.getClass().getMethod(name).invoke(value);
            } catch (NoSuchMethodException error) {
                continue;
            }
        }
        throw new NoSuchMethodException(value.getClass().getName() + "." + String.join("/", names));
    }

    private static Object field(Object value, String name) throws ReflectiveOperationException {
        Field field = value.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(value);
    }

    private static Map<String, Object> object(Object... entries) {
        Map<String, Object> result = new TreeMap<>();
        for (int index = 0; index < entries.length; index += 2) {
            result.put((String) entries[index], entries[index + 1]);
        }
        return result;
    }
}
