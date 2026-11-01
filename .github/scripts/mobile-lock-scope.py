# AUTHORED-BY Claude Opus 5.5
"""Decide whether a lockfile change reaches the mobile shells.

Usage: mobile-lock-scope.py <base-lockfile> <head-lockfile>
Prints "true" when the resolved dependency closure of the mobile importers, or any lockfile-wide
field outside the dependency graph, differs between the two files; otherwise "false".
A missing or unparsable file, or a reference without a snapshot or package record, counts as a
change, so the mobile jobs run.
"""

import sys

import yaml

ROOTS = ("apps/mobile", "packages/suite-native")
GRAPH_KEYS = ("importers", "packages", "snapshots")
DEP_FIELDS = ("dependencies", "devDependencies", "optionalDependencies")


def ref_to_key(name, reference):
    """Mirror pnpm's dependency-path refToRelative: aliases ("real@1.0.0") are already keys."""
    if reference.startswith("@"):
        return reference
    at = reference.find("@")
    if at == -1:
        return f"{name}@{reference}"
    colon, bracket = reference.find(":"), reference.find("(")
    if (colon == -1 or at < colon) and (bracket == -1 or at < bracket):
        return reference
    return f"{name}@{reference}"


def package_key(key):
    """Strip trailing peer-dependency suffixes ("(peer@1.0.0)") the way pnpm's dependency-path does."""
    while key.endswith(")"):
        depth = 0
        for index in range(len(key) - 1, -1, -1):
            depth += {")": 1, "(": -1}.get(key[index], 0)
            if depth == 0:
                break
        else:
            raise KeyError(f"unbalanced peer suffix in {key}")
        key = key[:index]
    return key


def closure(lock):
    importers = lock.get("importers") or {}
    snapshots = lock.get("snapshots") or {}
    seen_importers, seen_packages = set(), set()
    pending_importers = list(ROOTS)
    pending_packages = []
    while pending_importers or pending_packages:
        if pending_importers:
            path = pending_importers.pop()
            if path in seen_importers:
                continue
            seen_importers.add(path)
            importer = importers.get(path) or {}
            for field in DEP_FIELDS:
                for name, entry in (importer.get(field) or {}).items():
                    version = str((entry or {}).get("version", ""))
                    if version.startswith("link:"):
                        target = version[len("link:") :]
                        parts = [p for p in (path + "/" + target).split("/") if p and p != "."]
                        resolved = []
                        for part in parts:
                            if part == "..":
                                if resolved:
                                    resolved.pop()
                            else:
                                resolved.append(part)
                        pending_importers.append("/".join(resolved))
                    else:
                        pending_packages.append(ref_to_key(name, version))
            continue
        key = pending_packages.pop()
        if key in seen_packages:
            continue
        seen_packages.add(key)
        if key not in snapshots:
            raise KeyError(f"unresolved lockfile reference {key}")
        snapshot = snapshots[key] or {}
        for field in ("dependencies", "optionalDependencies"):
            for name, version in (snapshot.get(field) or {}).items():
                pending_packages.append(ref_to_key(name, str(version)))
    packages = lock.get("packages") or {}
    package_view = {}
    for key in sorted(seen_packages):
        base = package_key(key)
        if base not in packages:
            raise KeyError(f"no package record for {key}")
        package_view[key] = (snapshots[key], packages[base])
    importer_view = {path: importers.get(path) for path in sorted(seen_importers)}
    return importer_view, package_view


def view(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    # pnpm never writes anchors, aliases or merge keys; BaseLoader would leave them unexpanded, so
    # treat any as a change rather than walk a graph that may be missing inherited entries.
    for event in yaml.parse(text, Loader=yaml.BaseLoader):
        if isinstance(event, yaml.AliasEvent) or getattr(event, "anchor", None):
            raise ValueError("lockfile uses YAML anchors or aliases")
        if isinstance(event, yaml.ScalarEvent) and event.value == "<<" and event.style is None:
            raise ValueError("lockfile uses a YAML merge key")
    # BaseLoader keeps every scalar a string: YAML 1.1 coercion would turn unquoted alias keys
    # such as "on" and "yes" into True and silently merge them.
    lock = yaml.load(text, Loader=yaml.BaseLoader)
    # Every top-level field outside the dependency graph (settings, overrides, checksums, ...) is compared whole.
    return {key: value for key, value in lock.items() if key not in GRAPH_KEYS}, closure(lock)


def main():
    try:
        changed = view(sys.argv[1]) != view(sys.argv[2])
    except Exception as error:  # noqa: BLE001 - any doubt means run the mobile jobs
        print(f"mobile-lock-scope: {error!r}; running mobile jobs", file=sys.stderr)
        changed = True
    print("true" if changed else "false")


if __name__ == "__main__":
    main()
