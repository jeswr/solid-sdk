// AUTHORED-BY Codex GPT-6
export const CAPTURE_PERMISSION_PORT = 'AGENT_CAPTURE_PERMISSIONS';
export const capturePermissions = (site: string) => {
  const url = new URL(site);
  const pattern = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}/*`;
  return { permissions: ['cookies'], origins: [pattern] };
};

export async function releaseCapturePermissions(
  api: { remove(permissions: chrome.permissions.Permissions): Promise<boolean> },
  origins: string[],
): Promise<void> {
  // Chrome rejects an entire removal containing a host covered by required <all_urls>.
  // Independent calls ensure that rejection can never retain the optional cookies API.
  const [cookies] = await Promise.allSettled([
    (async () => api.remove({ permissions: ['cookies'] }))(),
    (async () => api.remove({ origins }))(),
  ]);
  // Required host access stays in place. An optional origin, if acquired, is removed above.
  if (cookies.status === 'rejected' || !cookies.value)
    throw new Error('Sign-in permission cleanup unavailable.');
}
