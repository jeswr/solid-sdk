// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { constants } from "fs";
import { lstat, mkdir, open } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, join } from "path";

function xml(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject XML-forbidden control characters
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new Error("Invalid plist value");
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
export function launchdPlist(options: { command: readonly string[]; logs: string }): string {
  if (!options.command.length || !isAbsolute(options.command[0] ?? "") || !isAbsolute(options.logs))
    throw new Error("launchd requires absolute paths");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.jeswr.agent</string>
<key>ProgramArguments</key><array>${options.command.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(options.logs, "stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(options.logs, "stderr.log"))}</string>
</dict></plist>
`;
}
/** Confirmation precedes every filesystem mutation. Never bootstraps or loads launchd. */
export async function installLaunchd(options: {
  command: readonly string[];
  confirm: (prompt: string) => Promise<boolean>;
  home?: string;
  platform?: string;
}): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "darwin")
    throw new Error("launchd requires macOS");
  const home = options.home ?? homedir();
  if (!isAbsolute(home)) throw new Error("Invalid home directory");
  const logs = join(home, "Library", "Logs", "jeswr-agent");
  const destination = join(home, "Library", "LaunchAgents");
  const body = launchdPlist({ command: options.command, logs });
  if (!(await options.confirm(`Install org.jeswr.agent at ${destination}?`))) return false;
  await mkdir(logs, { recursive: true, mode: 0o700 });
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const directory of [logs, destination]) {
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & (directory === logs ? 0o077 : 0o022)
    )
      throw new Error("Unsafe launchd directory");
  }
  // Never overwrite an existing job or follow a symlink, even after confirmation.
  const file = await open(
    join(destination, "org.jeswr.agent.plist"),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(body, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  return true;
}
