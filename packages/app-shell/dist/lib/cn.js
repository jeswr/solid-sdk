/** Join truthy class values into a single space-separated string. */
export function cn(...values) {
    return values.filter((v) => Boolean(v)).join(" ");
}
