// A disposable test CA for local HTTPS servers (Solid Nextcloud, PHP Solid Server): generated with the
// `openssl` CLI into interop/.local-tls/ (git-ignored), with one server certificate for localhost,
// *.localhost, 127.0.0.1 and ::1. Node trusts it through NODE_EXTRA_CA_CERTS (see interop/run.js); nothing
// is installed system-wide. Local containers only — never used for live targets.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const tlsDirectory = fileURLToPath(new URL("../.local-tls/", import.meta.url));
export const caCertificate = `${tlsDirectory}ca.pem`;

/** Regenerate when a certificate expires within this margin (they are issued for 30 days). */
const renewalMarginMs = 7 * 24 * 60 * 60 * 1000;

function fresh(path) {
  if (!existsSync(path)) return false;
  try {
    return (
      Date.parse(new X509Certificate(readFileSync(path)).validTo) - Date.now() > renewalMarginMs
    );
  } catch {
    return false;
  }
}

/** Creates the CA and server certificate, or re-creates both when either is missing or close to expiry. */
export function ensureTestCertificates() {
  const paths = {
    ca: caCertificate,
    cert: `${tlsDirectory}server.pem`,
    key: `${tlsDirectory}server-key.pem`,
  };
  if (fresh(paths.ca) && fresh(paths.cert) && existsSync(paths.key)) return paths;
  mkdirSync(tlsDirectory, { recursive: true });
  const openssl = (args) =>
    execFileSync("openssl", args, { cwd: tlsDirectory, stdio: ["ignore", "ignore", "pipe"] });
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "30",
    "-subj",
    "/CN=reactive-authentication interop test CA (disposable)",
    "-keyout",
    "ca-key.pem",
    "-out",
    "ca.pem",
  ]);
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-keyout",
    "server-key.pem",
    "-out",
    "server.csr",
  ]);
  writeFileSync(
    `${tlsDirectory}server.ext`,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1",
      "",
    ].join("\n"),
  );
  openssl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca-key.pem",
    "-CAcreateserial",
    "-days",
    "30",
    "-extfile",
    "server.ext",
    "-out",
    "server.pem",
  ]);
  return paths;
}
