// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from '../fixtures';
import { grantOrigin, performLogin } from './helpers';

test('round-trips PNG bytes through explicit PUT, Request uploads and patched Request GET', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);
  const page = await context.newPage();
  await page.goto('http://localhost:8080');
  await grantOrigin(context, page, undefined, {
    classIRI: 'https://schema.org/ImageObject',
    modes: ['read', 'write'],
    targetUrl: '/private/binary.png',
  });
  await page.waitForFunction(
    () => typeof (window as unknown as { solid?: { fetch?: unknown } }).solid?.fetch === 'function',
  );

  const url = 'http://localhost:3000/test-pod/private/binary.png';
  try {
    const result = await page.evaluate(async (target) => {
      const solid = (window as unknown as { solid: { fetch: typeof fetch } }).solid;
      // A real 1x1 PNG followed by every byte value, repeated, catches UTF-8 corruption.
      const png = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/RsAAAAASUVORK5CYII=',
        ),
        (char) => char.charCodeAt(0),
      );
      const bytes = new Uint8Array(png.length + 1024);
      bytes.set(png);
      for (let i = png.length; i < bytes.length; i++) bytes[i] = (i - png.length) % 256;
      const roundTrips = [];
      for (const requestUpload of [false, true]) {
        // Change the second upload so stale cached bytes cannot satisfy its assertions.
        bytes[bytes.length - 1] = requestUpload ? 42 : 255;
        const init = {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: bytes,
        };
        const put = requestUpload
          ? await window.fetch(new Request(target, init))
          : await solid.fetch(target, init);
        if (!put.ok) throw new Error(`Binary PUT failed (Request=${requestUpload}): ${put.status}`);
        const get = await window.fetch(new Request(target));
        const received = new Uint8Array(await get.arrayBuffer());
        roundTrips.push({
          status: get.status,
          contentType: get.headers.get('content-type'),
          expected: Array.from(bytes),
          received: Array.from(received),
        });
      }
      return roundTrips;
    }, url);
    for (const roundTrip of result) {
      expect(roundTrip.status).toBe(200);
      expect(roundTrip.contentType).toContain('image/png');
      expect(roundTrip.received).toEqual(roundTrip.expected);
    }
    // Success must prove extension authentication, rather than public pod access.
    const anonymous = await context.request.get(url);
    expect([401, 403]).toContain(anonymous.status());
  } finally {
    await page.evaluate(async (target) => {
      const solid = (window as unknown as { solid: { fetch: typeof fetch } }).solid;
      const response = await solid.fetch(target, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Binary cleanup failed: ${response.status}`);
    }, url);
  }
});
