import java.io.DataInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.TreeSet;
import java.util.zip.ZipFile;

public class TextureStrings {
    public static void main(String[] args) {
        try {
            if (args.length != 1) throw new IllegalArgumentException("Usage: TextureStrings.java <client.jar>");
            var textures = new TreeSet<String>();
            try (var jar = new ZipFile(args[0])) {
                var entries = jar.entries();
                while (entries.hasMoreElements()) {
                    var entry = entries.nextElement();
                    if (!entry.getName().endsWith(".class")) continue;
                    try (var input = new DataInputStream(jar.getInputStream(entry))) {
                        if (input.readInt() != 0xcafebabe) throw new IOException("Invalid class: " + entry.getName());
                        input.skipNBytes(4);
                        int count = input.readUnsignedShort();
                        var text = new String[count];
                        var strings = new ArrayList<Integer>();
                        for (int index = 1; index < count; index++) {
                            int tag = input.readUnsignedByte();
                            switch (tag) {
                                case 1 -> text[index] = input.readUTF();
                                case 3, 4, 9, 10, 11, 12, 17, 18 -> input.skipNBytes(4);
                                case 5, 6 -> { input.skipNBytes(8); index++; }
                                case 7, 16, 19, 20 -> input.skipNBytes(2);
                                case 8 -> strings.add(input.readUnsignedShort());
                                case 15 -> input.skipNBytes(3);
                                default -> throw new IOException("Invalid constant pool tag " + tag + ": " + entry.getName());
                            }
                        }
                        for (int index : strings) {
                            if (text[index].matches("textures/entity/[^\\s]+\\.png")) textures.add(text[index]);
                        }
                    }
                }
            }
            textures.forEach(System.out::println);
        } catch (Exception error) {
            System.err.println("Texture string scan failed: " + error.getMessage());
            System.exit(1);
        }
    }
}
