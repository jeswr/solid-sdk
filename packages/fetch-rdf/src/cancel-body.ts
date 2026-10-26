
/** Best-effort cleanup, called without awaiting so response errors propagate immediately. */
export async function cancelResponseBody(response: Response): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      response.body?.cancel(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1_000);
      }),
    ]);
  } catch {
    // Only cancellation failures are swallowed; callers retain their original error.
  } finally {
    clearTimeout(timeout);
  }
}
