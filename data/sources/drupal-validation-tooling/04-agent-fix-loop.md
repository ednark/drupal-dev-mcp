# The agent fix loop: run, fix, re-run

Intent: how coding agents should use deterministic checks — as a closed verification loop scoped to what they touched — instead of as one-time advice or always-loaded rules.

Source: https://menetray.com/en/blog/green-tests-arent-enough-thats-why-my-ai-goes-through-audit

## The pattern

1. Agent finishes a task on a file set S.
2. Agent runs the deterministic checks over S: tests, PHPStan, PHPCS, complexity/duplication — or the audit module's Drush commands, which return JSON (see the `audit` module source in this index).
3. Agent reads findings, maps each to its current-pattern doc (this index's `drupal-anti-patterns` corpus), fixes, and re-runs until clean or explicitly reported as remaining debt.
4. Human reviews the diff and the *remaining* findings, then signs off.

The loop matters more than the tool list: an agent that re-runs detects its own incomplete work; an agent told once does not. Keep instruction files minimal — commands belong in the loop (CI config, agent harness hooks, or a thin project skill), not in an always-loaded context file.

## Scoping rules

- **Run checks on what changed, not the world**: `phpcs`/`phpstan` on changed paths first; full sweeps in CI. Whole-tree runs on a large codebase train agents to ignore findings.
- **Baselines are contracts, not suggestions**: honor `phpstan-baseline.neon`; regenerate only deliberately and with review. An agent that "fixes" noise by regenerating a baseline launders regressions.
- **Auto-fix before review, never as review**: `phpcbf` and similar belong at the start of the loop; their diffs still get read.
- **Fail loudly on tool failure**: a check that could not run is a finding, not a pass. Silent tool absence turns the loop into theater.

## Mapping findings to repairs

Each deterministic finding has a current-pattern doc in the anti-patterns corpus:

| Finding class | Repair doc |
|---|---|
| Service locator in class | `01-service-locator-instead-of-di.md` |
| Complexity in `.module` hooks | `02-hook-implementations-in-module-file.md` |
| `|raw` / escaping | `03-twig-raw-and-escaping.md` |
| Cache max-age 0 / missing `#cache` | `04-cache-metadata-in-render-arrays.md` |
| Copy-paste detection | `05-duplicated-existing-functionality.md` |
| Large loops in submit/cron | `07-batch-and-queue-for-long-running-work.md` |
| Deprecated API usage | `08-old-apis-and-d7-isms.md` |

Findings with no mapping doc (cache bubbling correctness, semantic duplication, overengineering) are review signals — surface them to the human instead of "fixing" them.

## What "clean" means

All checks green means: no error the configured tools know how to detect. It does not mean the architecture fits the project, the feature was needed, or the cache metadata is *correct* (only that it is present). Human sign-off remains part of the loop — the last layer, not a formality.
