# AUTHORED-BY Claude Opus 5.5
"""Decide whether a lockfile change reaches the mobile shells.

Usage: mobile-lock-scope.py <base-lockfile> <head-lockfile>
Prints "true" when the resolved dependency closure of the mobile importers, or the
lockfile-wide resolution settings, differ between the two files; otherwise "false".
A missing or unparsable file counts as a change, so the mobile jobs run.
"""

import sys

import yaml

ROOTS = ("apps/mobile", "packages/suite-native")
GLOBAL_KEYS = ("lockfileVersion", "settings", "overrides", "patchedDependencies", "catalogs")
DEP_FIELDS = ("dependencies", "devDependencies", "optionalDependencies")


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
                        pending_packages.append(f"{name}@{version}")
            continue
        key = pending_packages.pop()
        if key in seen_packages:
            continue
        seen_packages.add(key)
        snapshot = snapshots.get(key) or {}
        for field in ("dependencies", "optionalDependencies"):
            for name, version in (snapshot.get(field) or {}).items():
                pending_packages.append(f"{name}@{version}")
    importer_view = {path: importers.get(path) for path in sorted(seen_importers)}
    package_view = {key: (lock.get("packages") or {}).get(key.split("(", 1)[0]) for key in sorted(seen_packages)}
    return importer_view, sorted(seen_packages), package_view


def view(path):
    with open(path, encoding="utf-8") as handle:
        lock = yaml.safe_load(handle)
    return {key: lock.get(key) for key in GLOBAL_KEYS}, closure(lock)


def main():
    try:
        changed = view(sys.argv[1]) != view(sys.argv[2])
    except Exception as error:  # noqa: BLE001 - any doubt means run the mobile jobs
        print(f"mobile-lock-scope: {error!r}; running mobile jobs", file=sys.stderr)
        changed = True
    print("true" if changed else "false")


if __name__ == "__main__":
    main()
