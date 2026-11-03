// AUTHORED-BY Claude Opus 5.5
/**
 * Cancellation at the Pod I/O boundary. A run checks its signal immediately before each
 * PodWriter port call, so an abort during an earlier await (an import session's implicit
 * read, the provenance read in finish(), a Type Index read) still stops the write that
 * follows. Every Pod writer path goes through these wrappers; never check only at the
 * session entry, which can await a read before the write it guards.
 */
import { snapshotFetchInput } from "@jeswr/guarded-fetch";
import type {
  BinaryDoc,
  NormalisedDoc,
  PodWriter,
  TypeRegistrationRequest,
  WriteConditions,
} from "./types.js";

/** Wrap an async step so it rejects with the abort reason instead of starting once aborted. */
export function unlessAborted<A extends unknown[], R>(
  signal: AbortSignal | undefined,
  step: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args) => {
    try {
      signal?.throwIfAborted();
    } catch (error) {
      return Promise.reject(error);
    }
    return step(...args);
  };
}

/**
 * A PodWriter whose every port (read, write, writeBinary, remove, registerType) checks the
 * signal immediately before it is invoked. Optional ports stay absent when the writer has none.
 */
export function abortablePodWriter(writer: PodWriter, signal: AbortSignal | undefined): PodWriter {
  const { writeBinary, remove } = writer;
  return {
    webId: writer.webId,
    resolve: (slug) => writer.resolve(slug),
    read: unlessAborted(signal, (slug: string) => writer.read(slug)),
    write: unlessAborted(signal, (doc: NormalisedDoc, conditions?: WriteConditions) =>
      writer.write(doc, conditions),
    ),
    ...(writeBinary && {
      writeBinary: unlessAborted(signal, (doc: BinaryDoc) => writeBinary.call(writer, doc)),
    }),
    ...(remove && {
      remove: unlessAborted(signal, (slug: string, conditions?: { readonly ifMatch?: string }) =>
        remove.call(writer, slug, conditions),
      ),
    }),
    registerType: unlessAborted(signal, (registrations: readonly TypeRegistrationRequest[]) =>
      writer.registerType(registrations),
    ),
  };
}

/**
 * A transport that refuses every request once `signal` aborts, checked immediately before
 * sending, and passes `signal` to the request itself, composed with the request's effective
 * signal (`init.signal` overrides a Request's own, as in Fetch).
 */
export function abortableFetch(transport: typeof fetch, signal: AbortSignal): typeof fetch {
  return (input, init) => {
    try {
      signal.throwIfAborted();
    } catch (error) {
      return Promise.reject(error);
    }
    const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
    const effective =
      snapshot.init && "signal" in snapshot.init
        ? snapshot.init.signal
        : typeof snapshot.input === "string"
          ? undefined
          : snapshot.input.signal;
    return transport(snapshot.input, {
      ...snapshot.init,
      signal: effective ? AbortSignal.any([signal, effective]) : signal,
    });
  };
}
