#!/usr/bin/env zsh
# AUTHORED-BY Codex GPT-6.1-Sol
# Deliberately uses the POSIX subset so the fake-op test also runs where zsh is absent.
set +x
set -eu
# No token is put in argv, a shell variable, or an external temporary file.
# The NUL marks a successful op exit, so partial output from a failed op is refused.
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
        { op read "$reference" 2>/dev/null && printf '\000'; } |
          node "$script_dir/provision-writer.mjs" --reference "$reference" "$@"
      fi
      ;;
  esac
done
