// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.io.Closeable;
import java.io.IOException;

/** No-follow filesystem operations for PDF preview cleanup. */
interface PreviewFs {
    interface Directory extends Closeable {}

    final class Stat {
        final long device;
        final long inode;
        final boolean directory;

        Stat(long device, long inode, boolean directory) {
            this.device = device;
            this.inode = inode;
            this.directory = directory;
        }
    }

    /**
     * Opens a path, refusing a symlink in the final component. Callers must fstat the result and
     * check it is the directory they expected before using it.
     */
    Directory openDirectory(String path) throws IOException;

    Directory openDirectory(Directory parent, String name) throws IOException;

    Stat fstat(Directory directory) throws IOException;

    Stat lstat(String path) throws IOException;

    Stat lstat(Directory parent, String name) throws IOException;

    /** Lists immediate child names through the open directory. */
    String[] list(Directory directory) throws IOException;

    void unlink(Directory parent, String name) throws IOException;

    void rmdir(Directory parent, String name) throws IOException;
}
