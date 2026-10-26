import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This package is `"type": "module"`; Playwright loads this file as ESM, where `__dirname`
// is not defined. Derive it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverProcess: ChildProcess | null = null;

const CSS_PORT = 3000;
const CSS_BASE_URL = `http://localhost:${CSS_PORT}`;

export async function startCSSServer(): Promise<void> {
  const seedConfig = path.resolve(__dirname, 'seed.json');
  const cssConfig = path.resolve(__dirname, 'css-config.json');

  // A server left on the port (e.g. by an aborted run) would answer the readiness probe
  // while ours exits with EADDRINUSE, so the suite would silently run against stale state.
  if (await isServerUp(CSS_BASE_URL)) {
    throw new Error(`Port ${CSS_PORT} is already in use; stop the server holding it first.`);
  }

  // Run the CSS entry point directly (not via npx) so SIGTERM reaches the server itself.
  const cssBin = createRequire(import.meta.url).resolve('@solid/community-server/bin/server.js');
  serverProcess = spawn(
    process.execPath,
    [cssBin, '-p', String(CSS_PORT), '-c', cssConfig, '--seedConfig', seedConfig, '-l', 'warn'],
    {
      stdio: 'pipe',
      env: { ...process.env },
    },
  );

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('error')) {
      console.error('[CSS]', msg);
    }
  });

  let exitCode: number | null = null;
  serverProcess.on('exit', (code) => {
    exitCode = code ?? -1;
  });

  // Wait for the server to be ready
  await waitForServer(CSS_BASE_URL, 30_000, () => exitCode);
}

export async function stopCSSServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function isServerUp(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(
  url: string,
  timeoutMs: number,
  exited: () => number | null,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const code = exited();
    if (code !== null) throw new Error(`Community Solid Server exited early (code ${code})`);
    if (await isServerUp(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

export { CSS_BASE_URL, CSS_PORT };
