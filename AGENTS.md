# AGENTS.md

This file gives coding agents project-specific context. Keep it short and update it when workflows change.

## Project Overview

- Primary app or package:
- Main entry points:
- Important directories:

## Architecture Notes

- Module boundaries:
- Generated or vendored code:
- Sensitive areas:

## Commands

<!-- fallow init prefilled these from package.json; confirm before relying on them -->
- Install:
- Build:
- Test:
- Typecheck or lint: tsc --noEmit

## Fallow

- Use `fallow audit --format json --quiet` before committing AI-generated changes.
- Use `fallow dead-code --format json --quiet`, `fallow dupes --format json --quiet`, and `fallow health --format json --quiet` for targeted checks.
- Use `fallow list --entry-points --format json --quiet` and `fallow list --boundaries --format json --quiet` to inspect project shape.

<!-- generated:task-matrix:start -->
| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| find how one module reaches another | `fallow trace --path <from> <to>` (Reports `reachable: false` instead of failing when no import path exists; type-only hops are reported, not skipped.) |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| read a diff before approving it | `fallow review --base <ref> --brief` (orientation, never gates: deterministic and always exit 0, unlike the audit row) |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- generated:task-matrix:end -->

## Agent Rules

- For new work, use `main` in the primary checkout. If a session starts in a worktree, direct project commands and edits to the primary checkout; use an isolated branch or worktree only when explicitly requested.
- For project coding work, read and apply [architectural-code-partner](.agents/skills/architectural-code-partner/SKILL.md). It defines Full/Quick modes, human-owned implementation exercises, and use of the existing design journal and learning log. Honor explicit task overrides and previously settled decisions.
- Do not edit:
- Always ask before:
- Preferred style:
