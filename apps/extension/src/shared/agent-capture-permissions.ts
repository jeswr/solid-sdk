// AUTHORED-BY Codex GPT-6
export const CAPTURE_PERMISSION_PORT = 'AGENT_CAPTURE_PERMISSIONS';
export const captureOriginPermission = (site: string) => {
  const url = new URL(site);
  const pattern = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}/*`;
  return { origins: [pattern] };
};
export const capturePermissions = () => ({ permissions: ['cookies'] });

export async function releaseCapturePermissions(api: {
  remove(permissions: chrome.permissions.Permissions): Promise<boolean>;
  contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
}): Promise<void> {
  // Never change host access: a request could permanently promote a withheld required host.
  let rejected = false;
  try {
    await api.remove(capturePermissions());
  } catch {
    rejected = true;
    // Still check the resulting authority, without exposing Chrome diagnostics.
  }
  const present = await api.contains(capturePermissions());
  if (rejected || present) throw new Error('Sign-in permission cleanup unavailable.');
}
