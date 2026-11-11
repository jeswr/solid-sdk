// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.os.ParcelFileDescriptor;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.io.IOException;

/** Descriptor-relative cleanup using the public Android API available at API 24. */
final class AndroidPreviewFs implements PreviewFs {
    // Linux's value on Android ABIs; OsConstants only exposes this flag from API 27.
    private static final int O_CLOEXEC = 02000000;

    private static final class AndroidDirectory implements Directory {
        final ParcelFileDescriptor descriptor;

        AndroidDirectory(ParcelFileDescriptor descriptor) {
            this.descriptor = descriptor;
        }

        @Override public void close() throws IOException {
            descriptor.close();
        }
    }

    @Override public Directory openDirectory(String path) throws IOException {
        ParcelFileDescriptor owned = null;
        try {
            // No O_DIRECTORY (not in OsConstants at API 24): the caller's fstat check refuses
            // anything that is not the expected directory, and O_NONBLOCK keeps a FIFO from blocking.
            FileDescriptor opened = Os.open(path,
                OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_NONBLOCK | O_CLOEXEC, 0);
            try {
                // Retain the duplicate so getFd() supplies the procfs number without reflection.
                owned = ParcelFileDescriptor.dup(opened);
            } finally {
                Os.close(opened);
            }
            return new AndroidDirectory(owned);
        } catch (ErrnoException e) {
            IOException failure = new IOException("Cannot open preview directory", e);
            closeAfterFailure(owned, failure);
            throw failure;
        } catch (IOException | RuntimeException e) {
            closeAfterFailure(owned, e);
            throw e;
        }
    }

    @Override public Directory openDirectory(Directory parent, String name) throws IOException {
        return openDirectory(childPath(parent, name));
    }

    @Override public Stat fstat(Directory directory) throws IOException {
        try {
            return stat(Os.fstat(((AndroidDirectory) directory).descriptor.getFileDescriptor()));
        } catch (ErrnoException e) {
            throw new IOException("Cannot stat preview directory", e);
        }
    }

    @Override public Stat lstat(String path) throws IOException {
        try {
            return stat(Os.lstat(path));
        } catch (ErrnoException e) {
            throw new IOException("Cannot stat preview entry", e);
        }
    }

    @Override public Stat lstat(Directory parent, String name) throws IOException {
        return lstat(childPath(parent, name));
    }

    @Override public String[] list(Directory directory) throws IOException {
        String[] names = new File(directoryPath(directory)).list();
        if (names == null) throw new IOException("Cannot list preview directory");
        return names;
    }

    @Override public void unlink(Directory parent, String name) throws IOException {
        remove(parent, name);
    }

    @Override public void rmdir(Directory parent, String name) throws IOException {
        remove(parent, name);
    }

    private void remove(Directory parent, String name) throws IOException {
        try {
            // Android exposes remove(3), not unlink/rmdir. Neither branch follows the final link.
            Os.remove(childPath(parent, name));
        } catch (ErrnoException e) {
            throw new IOException("Cannot remove preview entry", e);
        }
    }

    private static Stat stat(StructStat stat) {
        return new Stat(stat.st_dev, stat.st_ino, OsConstants.S_ISDIR(stat.st_mode));
    }

    private static String directoryPath(Directory directory) {
        return "/proc/self/fd/" + ((AndroidDirectory) directory).descriptor.getFd();
    }

    private static String childPath(Directory parent, String name) {
        return directoryPath(parent) + "/" + name;
    }

    private static void closeAfterFailure(ParcelFileDescriptor descriptor, Exception failure) {
        if (descriptor != null) {
            try {
                descriptor.close();
            } catch (IOException e) {
                failure.addSuppressed(e);
            }
        }
    }
}
