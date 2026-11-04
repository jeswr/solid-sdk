// AUTHORED-BY Codex GPT-6.1-Sol
/** Deterministic, entirely fictional mboxrd. Five messages per conversation. */
export function mailboxFixture(count = 50): string {
  const messages: string[] = [];
  for (let i = 0; i < count; i++) {
    const group = Math.floor(i / 5);
    const first = group * 5;
    const sender = i % 2 ? "Noel Reed <noel@example.org>" : "Mira Vale <mira@example.org>";
    const labels = [
      "Inbox",
      ...(i % 2 === 0 ? ["Unread"] : []),
      ...(i % 11 === 0 ? ["Starred"] : []),
      ...(i % 7 === 0 ? ["Important"] : []),
      ...(i % 3 === 0 ? ["Garden club"] : []),
      ...(i % 4 === 0 ? ["Travel"] : []),
    ];
    const headers = [
      "From sender@example.org Thu Jan 01 00:00:00 2026",
      `Message-ID: <sample-${i}@example.org>`,
      `From: ${sender}`,
      "To: Garden friends <friends@example.org>",
      "Cc: Alex Moss <alex@example.org>",
      `Date: ${new Date(Date.UTC(2026, 2, 1, 10 + i)).toUTCString()}`,
      `Subject: ${i === first ? "" : "Re: "}Garden plans ${group + 1}`,
      `X-Gmail-Labels: ${labels.join(",")}`,
      "MIME-Version: 1.0",
      ...(i === first
        ? []
        : [
            `References: <sample-${first}@example.org>`,
            `In-Reply-To: <sample-${i - 1}@example.org>`,
          ]),
    ];
    let body = `Hello friends,\nHere are our fictional garden notes ${i + 1}.\nSee you at the community garden.\n`;
    if (i === 1) body += "\nOn Sun, 1 Mar 2026 Mira wrote:\n> Bring some seeds.\n> Thanks!\n";
    if (i === 2) {
      headers.push("Content-Type: text/html; charset=utf-8");
      body =
        '<p>Our <strong>garden</strong> is growing.</p><img src="https://tracker.example.org/pixel"><script>alert(1)</script>\n';
    } else if (i === 3 || i === 8) {
      headers.push(`Content-Type: multipart/mixed; boundary="sample-part-${i}"`);
      body = `--sample-part-${i}\nContent-Type: text/plain; charset=utf-8\n\n${body}\n--sample-part-${i}\nContent-Type: text/plain; name="garden-${i}.txt"\nContent-Disposition: attachment; filename="garden-${i}.txt"\nContent-Transfer-Encoding: base64\n\nU2VlZHMgYW5kIHdhdGVyCg==\n--sample-part-${i}--\n`;
    } else headers.push("Content-Type: text/plain; charset=utf-8");
    messages.push(`${headers.join("\n")}\n\n${body}`);
  }
  return messages.join("");
}
export async function* mailboxChunks(count = 50, chunkSize = 997): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(mailboxFixture(count));
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    yield bytes.subarray(offset, offset + chunkSize);
}
