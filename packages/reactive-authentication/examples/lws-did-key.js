// LWS self-signed identity with did:key (the discontinued did:key draft, also accepted by the controlled
// identifier suite): the identifier is derived from the public key, so no document needs hosting.
import {
  CredentialBoundary,
  DidKeySource,
  LwsTokenProvider,
  ReactiveFetchManager,
} from "@jeswr/reactive-authentication";

const source = await DidKeySource.generate("Ed25519"); // or DidKeySource.fromKeyPair(existingPair)
console.log("agent identifier:", source.did); // grant this DID access in the storage

const manager = new ReactiveFetchManager({
  providers: [new LwsTokenProvider(source)],
  boundary: new CredentialBoundary(["https://storage.example/root/"]),
});
console.log((await manager.fetch("https://storage.example/root/data")).status);
