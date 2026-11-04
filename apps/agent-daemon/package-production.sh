#!/bin/sh
# AUTHORED-BY Codex GPT-6
# Run from the workspace root after the daemon's dependency-first build.
set -eu
production_dir=$1
case "$production_dir" in
  /*) ;;
  *) echo 'Production output must be an absolute path' >&2; exit 1 ;;
esac
if [ -e "$production_dir" ]; then
  echo 'Production output must be a fresh directory' >&2
  exit 1
fi

pnpm exec turbo prune @jeswr/app-agent-daemon --production --out-dir="$production_dir"
# Turbo respects .gitignore, so copy the fresh build outputs explicitly.
for project in "$production_dir"/packages/* "$production_dir"/apps/agent-daemon; do
  cp -a "${project#"$production_dir"/}/dist" "$project/dist"
done
cd "$production_dir"
# A fresh install retains the pruned lock's resolutions. Legacy deploy overrides
# frozen-lockfile; offline alone would still allow different cached versions.
pnpm install --prod --frozen-lockfile --offline --ignore-scripts
# Preserve the documented paths used by trusted derived images.
ln -s apps/agent-daemon/bin bin
ln -s apps/agent-daemon/dist dist
