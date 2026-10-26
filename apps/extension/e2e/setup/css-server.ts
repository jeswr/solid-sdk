import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This package is `"type": "module"`; Playwright loads this file as ESM, where `__dirname`
// is not defined. Derive it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverProcess: ChildProcess | null = null;
let moduleRoot: string | null = null;

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
  moduleRoot = isolatedModuleRoot(cssBin);
  serverProcess = spawn(
    process.execPath,
    [
      cssBin,
      '-p',
      String(CSS_PORT),
      '-c',
      cssConfig,
      '--seedConfig',
      seedConfig,
      '-m',
      moduleRoot,
      '-l',
      'warn',
    ],
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
  if (moduleRoot) {
    fs.rmSync(moduleRoot, { recursive: true, force: true });
    moduleRoot = null;
  }
}

/**
 * Components.js scans every `node_modules` above its main module path. In the pnpm workspace
 * that includes the hoisted `node_modules/.pnpm/node_modules`, where other packages' Comunica
 * and CSS versions break config loading, while CSS's own transitive dependencies sit in
 * per-package folders it never visits. Build a temporary root with a flat `node_modules` of
 * CSS's dependency closure (first version found wins, as npm hoisting would) and point
 * Components.js at it.
 */
function isolatedModuleRoot(cssBin: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-e2e-css-'));
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(modules);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ext-e2e-css","private":true}\n');
  const linked = new Map<string, string>();
  const queue = [packageDir(fs.realpathSync(cssBin))];
  for (let dir = queue.shift(); dir; dir = queue.shift()) {
    const name = packageName(dir);
    if (linked.has(name)) continue;
    linked.set(name, dir);
    const target = path.join(modules, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(dir, target, 'dir');
    // pnpm keeps a package's dependencies beside it in the same `node_modules` folder.
    const siblings = path.resolve(dir, name.startsWith('@') ? '../..' : '..');
    for (const entry of fs.readdirSync(siblings)) {
      if (entry.startsWith('.')) continue;
      const entries = entry.startsWith('@')
        ? fs.readdirSync(path.join(siblings, entry)).map((scoped) => path.join(entry, scoped))
        : [entry];
      for (const dep of entries) {
        if (!linked.has(dep)) queue.push(fs.realpathSync(path.join(siblings, dep)));
      }
    }
  }
  return root;
}

function packageDir(file: string): string {
  let dir = path.dirname(file);
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

function packageName(dir: string): string {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name;
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
