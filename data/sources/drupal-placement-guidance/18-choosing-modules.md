# Choosing modules — verification before recommendation

Intent: how an agent should select and recommend modules — the decision flow that prevents the fabricated-module failure mode.

Source: https://www.drupal.org/docs/develop/creating-modules

## The failure mode

LLMs confidently recommend nonexistent modules: the duplication test's own research intake proposed `drupal/tool_api` (404 on drupal.org), and an expert benchmark run produced confident composer commands for `drupal/block_cache_pro` — a fabricated name. **Never recommend a module by machine name without verifying it exists.**

## The verification flow

1. **Verify existence deterministically** against the indexed registry (`verify_drupal_modules`): per machine name, `core` / `contrib` / `not_found` with evidence. `not_found` = do not recommend; say so and name the need instead.
2. **Core before contrib**: check the core snapshot for the target line first (`core/modules/<name>` — telephone and sdc teach that "core module" is a per-line claim, see placement 15).
3. **Version gate**: read the project's `core_version_requirement` from its `.info.yml` in the index — a `^11.3` constraint must never be recommended for a 10.6 site (the Canvas trap).
4. **Stability flag**: beta/RC projects (no security coverage) are recommended only with the flag stated.
5. **Popularity with denominator**: usage data undercounts (Update Status bias — see the usage-snapshot notes); prefer dependency-based signals for "agent-relevant" tagging.

## The decision rules

1. Need stated → does CORE provide it on this line? (snapshot check)
2. → does an installed contrib module provide it? (site inventory; the index's contrib sources document what's installed)
3. → does a well-known contrib project exist? (verify_drupal_modules + version gate)
4. → only then: recommend custom code, and name the requirement it serves (anti-pattern 06: every new module maps to a named requirement).

## Related corpus entries

- placement 15: removed/deprecated core modules per line.
- corpus-issues: fabricated-name findings (expert benchmark run #1; researcher intake tool_api).
