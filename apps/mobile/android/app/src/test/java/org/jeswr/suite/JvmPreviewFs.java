// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Real descriptor-relative operations for the Linux JVM tests. */
class JvmPreviewFs implements PreviewFs {
    private static final Pattern FILE_KEY = Pattern.compile("\\(dev=([0-9a-f]+),ino=([0-9]+)\\)");
    int openDirectories;

    private final class JvmDirectory implements Directory {
        final SecureDirectoryStream<Path> stream;

        JvmDirectory(SecureDirectoryStream<Path> stream) {
            this.stream = stream;
            openDirectories++;
        }

        @Override public void close() throws IOException {
            try {
                stream.close();
            } finally {
                openDirectories--;
            }
        }
    }

    @Override public Directory openDirectory(String path) throws IOException {
        Path absolute = Paths.get(path).toAbsolutePath();
        try (DirectoryStream<Path> parent = Files.newDirectoryStream(absolute.getParent())) {
            return new JvmDirectory(secure(parent).newDirectoryStream(absolute.getFileName(), LinkOption.NOFOLLOW_LINKS));
        }
    }

    @Override public Directory openDirectory(Directory parent, String name) throws IOException {
        return new JvmDirectory(stream(parent).newDirectoryStream(Paths.get(name), LinkOption.NOFOLLOW_LINKS));
    }

    @Override public Stat fstat(Directory directory) throws IOException {
        return stat(stream(directory).getFileAttributeView(BasicFileAttributeView.class).readAttributes());
    }

    @Override public Stat lstat(String path) throws IOException {
        return stat(Files.readAttributes(Paths.get(path), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS));
    }

    @Override public Stat lstat(Directory parent, String name) throws IOException {
        return stat(stream(parent).getFileAttributeView(Paths.get(name), BasicFileAttributeView.class,
            LinkOption.NOFOLLOW_LINKS).readAttributes());
    }

    @Override public String[] list(Directory directory) throws IOException {
        List<String> names = new ArrayList<>();
        for (Path child : stream(directory)) names.add(child.getFileName().toString());
        return names.toArray(new String[0]);
    }

    @Override public void unlink(Directory parent, String name) throws IOException {
        stream(parent).deleteFile(Paths.get(name));
    }

    @Override public void rmdir(Directory parent, String name) throws IOException {
        stream(parent).deleteDirectory(Paths.get(name));
    }

    private SecureDirectoryStream<Path> stream(Directory directory) {
        return ((JvmDirectory) directory).stream;
    }

    private SecureDirectoryStream<Path> secure(DirectoryStream<Path> directory) throws IOException {
        if (!(directory instanceof SecureDirectoryStream)) throw new IOException("Secure directory streams are required");
        return (SecureDirectoryStream<Path>) directory;
    }

    private Stat stat(BasicFileAttributes attributes) throws IOException {
        // OpenJDK's Linux file key contains the descriptor's device and inode, without a path lookup.
        Matcher key = FILE_KEY.matcher(String.valueOf(attributes.fileKey()));
        if (!key.matches()) throw new IOException("A Linux device/inode file key is required");
        return new Stat(Long.parseUnsignedLong(key.group(1), 16), Long.parseUnsignedLong(key.group(2)),
            attributes.isDirectory());
    }
}
