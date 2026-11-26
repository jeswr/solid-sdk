// AUTHORED-BY Codex GPT-6.1-Sol
/** Override selected members while preserving private-field receivers on the original object. */
export function boundProxy<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(receiver, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(receiver, property, receiver);
      return typeof value === "function" ? value.bind(receiver) : value;
    },
  });
}
