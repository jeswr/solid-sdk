#!/usr/bin/env zsh
# AUTHORED-BY Codex GPT-6.1-Sol
# Deliberately uses the POSIX subset so the fake-op test also runs where zsh is absent.
set +x
set -eu
# No token is put in argv, a shell variable, or an external temporary file.
# The writer pipes op stdout privately and checks its exit status before committing.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$script_dir/provision-writer.mjs" --validate "$@"
dry_run=false
for arg do
  if [ "$arg" = '--dry-run' ]; then dry_run=true; fi
done
for reference do
  case "$reference" in
    op://*)
      if [ "$dry_run" = true ]; then
        printf 'Would read %s\n' "$reference"
      else
        node "$script_dir/provision-writer.mjs" --reference "$reference" "$@"
      fi
      ;;
  esac
done
