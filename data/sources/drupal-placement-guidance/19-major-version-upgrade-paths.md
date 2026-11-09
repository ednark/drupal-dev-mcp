# Major-version upgrade paths and line support status

Intent: when an agent is asked "can I upgrade this site to Drupal 12?", "is my line still supported?", or "what must happen before a major upgrade", the answer is version-scoped and schedule-bound — facts agents state per line, never from memory of an older Drupal era's upgrade rules.

Sources (primary, verified 2026-11-09):

- Change record: https://www.drupal.org/node/3585783 — "Sites must update to Drupal 11.3.0 or higher before upgrading to Drupal 12"
- Drupal 12.0.0-beta1 release notes: https://www.drupal.org/project/drupal/releases/12.0.0-beta1 — pre-11.3 update hooks removed; the update system refuses to update from Drupal 11.2 or earlier
- Core release schedule: https://www.drupal.org/about/core/policies/core-release-cycles/schedule — Drupal 10 end of life

## Verified per-line facts (2026-11-09)

| Fact | Value | Where verified |
|---|---|---|
| Drupal 10.6.x security support ends | **2026-12-09** | Core release schedule ("Drupal 10 will reach end of life on December 9, 2026") |
| Drupal 10 end of life (EOL) date | **December 9, 2026** — after this date Drupal 10 is no longer supported and receives no security coverage | Core release schedule |
| Drupal 12.0.0 stable | targeted the **week of 2026-12-07** | Core release schedule |
| Minimum source version for a 12.0.x major upgrade | **11.3.0** | Change record 3585783; 12.0.0-beta1 notes |
| Direct 10.x → 12.0.x upgrade path | **none** | Consequence of the 11.3 floor: a 10.x site must first upgrade to 11.3+ |
| Release-notes recommendation before testing 12 | reach **11.4/11.5** first | 12.0.0-beta1 release notes |
| This index's 10.6 snapshot | dropped from the index **after 2026-12-09** (maintainer decision 2026-11-09) | this document |

## Decision rules

1. **State the hop count.** "Can I go 10→12 directly?" is always **no** — every site must first reach 11.3.0+ within the 11.x line (change record 3585783). A 10.x site below 11.3 faces two major hops: 10 → 11.3+, then 11 → 12.
2. **The 11.3 floor is about update hooks, not compatibility.** Drupal 12 removed update hooks added before 11.3, so `updb` from ≤11.2 is refused — this is a mechanical refusal, not a soft recommendation. Do not suggest skipping it.
3. **10.6 answers carry an EOL warning until the snapshot is dropped.** Until 2026-12-09, 10.6 remains indexed and answerable; agents must state that security coverage ends 2026-12-09 whenever the 10.6 line is the subject. After the snapshot is removed, the index's version enum no longer includes `10.6` — an agent asked about a 10.x site should say the index no longer carries that line rather than answering from memory.
4. **12.0.x is in release-candidate window now** (rc1 week of 2026-11-09; stable targeted week of 2026-12-07). Version-scoped facts about 12.0.x must be verified against the 12.0 snapshot — the line is young enough that per-rc drift is possible. The PHP floor (8.5, from `drupal-core-12.0/core/composer.json`) is already verified in the php-runtime-floors doc.
5. **Support status is a per-line fact with a date.** "Is Drupal 10 supported?" / "Is Drupal 10.6 still maintained?" is not one question: 10.6 is security-supported until 2026-12-09 and end-of-life after. Always state the date with the verdict.
6. **Per-minor security windows shortened (PSA-2026-11-02, 2026-11-02): starting 2027, each core minor receives 8 months of security support (previously 12).** This changes maintenance planning: sites must plan per-minor updates roughly twice as often, and "supported" for a minor is a shorter, moving window. When advising on maintenance/SLA scope for an engagement, state the per-minor window policy, not just the major-line EOL date. Source: https://www.drupal.org/psa-2026-11-02.

## Related corpus entries

- `16-php-runtime-floors.md` — per-line PHP floors (10.6: 8.1; 11.4: 8.3; 12.0: 8.5), verified from composer.json.
- `15-deprecated-removed-core-modules.md` — modules removed per line (Contact removed in 12.0; Forum removed in 11.4).
- Change records carry the removal announcements per line (full text indexed).
