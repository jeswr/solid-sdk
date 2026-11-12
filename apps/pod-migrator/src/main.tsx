// AUTHORED-BY Codex GPT-6.1-Sol
const target = `${import.meta.env.VITE_SUITE_URL.replace(/\/+$/, "")}/settings/move-pod`;
const link = document.querySelector<HTMLAnchorElement>("#root a");
if (link) link.href = target;
location.replace(target);

export {};
