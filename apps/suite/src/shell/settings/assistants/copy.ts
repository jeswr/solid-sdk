// AUTHORED-BY Codex GPT-6.1-Sol
export const assistantCopy = {
  claude: {
    label: "Claude",
    steps: [
      "In Claude, open Settings › Connectors. On Team and Enterprise plans, an owner adds it first in Organization settings › Connectors.",
      "Choose Add custom connector.",
      'Name it "Solid pod" and paste {url}. Leave Advanced settings empty.',
      "Choose Add, then Connect.",
      "Sign in with your Solid provider and choose Allow.",
    ],
    footer: "Turn it on from the tools menu in a chat.",
  },
  chatgpt: {
    label: "ChatGPT",
    steps: [
      "In ChatGPT on the web, open Settings › Apps (Connectors on some plans) › Advanced settings and turn on Developer mode.",
      "Choose Create app (Create on some plans).",
      'Name it "Solid pod", paste {url}, and choose OAuth for authentication.',
      "Confirm you trust the app, then choose Create.",
      "Sign in with your Solid provider and choose Allow.",
    ],
    footer:
      "Developer mode needs a paid plan and isn't in the desktop app. Pick it from the + menu in a chat.",
  },
} as const;
