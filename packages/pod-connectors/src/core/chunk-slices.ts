// AUTHORED-BY Codex GPT-6.1-Sol
/** Coalesce tiny input chunks so byte caps also bound slice-array overhead. */
export class ChunkSlices {
  private blocks: string[] = [];
  private pending: string[] = [];
  private chars = 0;

  push(slice: string): void {
    if (!slice) return;
    this.pending.push(slice);
    this.chars += slice.length;
    if (this.chars >= 16 * 1024) {
      this.blocks.push(this.pending.join(""));
      this.pending = [];
      this.chars = 0;
    }
  }

  clear(): void {
    this.blocks = [];
    this.pending = [];
    this.chars = 0;
  }

  text(): string {
    return this.blocks.join("") + this.pending.join("");
  }
}
