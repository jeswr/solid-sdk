// AUTHORED-BY GPT-6.1-Sol (Codex)
// Only dynamically registered on granted origins. The stub still asks the SW before enabling.
window.dispatchEvent(new window.CustomEvent('solid-extension:grant-patch'));

export {};
