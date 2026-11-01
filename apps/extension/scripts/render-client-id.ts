// AUTHORED-BY GPT-6.1-Sol (Codex)
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderClientIdDocument } from '../src/background/client-id-template.ts';

const manifestPath = new URL('../src/manifest.json', import.meta.url);
const documentPath = new URL('../public/clientid.jsonld', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// EXT_PUBKEY is optional after initial pinning: clean builds use the committed PUBLIC key.
// This script never reads, generates, or exports a private key.
const key: unknown = process.env.EXT_PUBKEY
  ? readFileSync(process.env.EXT_PUBKEY, 'utf8').trim()
  : manifest.key;
if (typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) {
  throw new Error(
    'Missing/invalid manifest public key; set EXT_PUBKEY to the supplied base64 DER file.',
  );
}
const der = Buffer.from(key, 'base64');
if (der.toString('base64') !== key) throw new Error('Public key must be canonical base64 DER.');
createPublicKey({ key: der, format: 'der', type: 'spki' });
const extensionId = createHash('sha256')
  .update(der)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
if (extensionId !== 'bicabcdahgfbkgmlidjpmiadmjlppikk') {
  throw new Error('Public key does not match the dispatcher-pinned extension ID.');
}

const rendered = `${JSON.stringify(renderClientIdDocument(extensionId), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (manifest.key !== key || readFileSync(documentPath, 'utf8') !== rendered) {
    throw new Error('Pinned manifest/document is stale; run npm run generate:client-id.');
  }
} else {
  if (manifest.key !== key) {
    manifest.key = key;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(documentPath, rendered);
}
