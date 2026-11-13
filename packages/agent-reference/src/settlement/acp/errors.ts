// AUTHORED-BY Codex GPT-6
export class AcpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}
