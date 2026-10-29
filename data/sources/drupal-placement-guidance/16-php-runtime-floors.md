# PHP runtime floors per Drupal line

Intent: the minimum PHP version each indexed Drupal line requires — a discrete, cited fact agents must state per line, never infer from memory.

Source: https://www.drupal.org/docs/getting-started/system-requirements

## Verified floors (from each line's core composer.json, 2026-10-29)

| Drupal line | PHP floor (composer `require.php`) | Where verified |
|---|---|---|
| 10.6.x | **>= 8.1.0** | `drupal-core-10.6/core/composer.json` |
| 11.4.x | **>= 8.3.0** | `drupal-core-11.4/core/composer.json` |
| 12.0.x | **>= 8.5.0** | `drupal-core-12.0/core/composer.json` |

The composer constraint is the floor. *Supported* (tested) PHP versions per release are a broader set — check the release notes / system requirements page when the distinction matters, and state which one you are reporting.

## Decision rules

1. **The floor is per line, not per major.** "Drupal 11 requires PHP 8.3" is a statement about 11.4's snapshot; an 11.0-era claim may differ. Always verify against the target line's composer.json.
2. **Contrib modules can raise the floor** above core's — a module requiring PHP 8.2 on a Drupal 10.6 site (floor 8.1) is a real incompatibility. The index extracts contrib `core_version_requirement` and PHP constraints from composer.json; prefer those over recollection (see the corpus-issues ledger: php-floor-drupal-11-contrib-proximity — a contrib composer.json once outranked core docs for this exact question).
3. **PHP-level security advisories are not Drupal advisories.** The security-advisories corpus here is core-only; PHP runtime vulnerabilities (e.g., PHP 8.x release-class issues) land upstream and reach Drupal only via the runtime floor/support matrix. Agents must not infer runtime safety from the absence of a Drupal SA.
4. **Symfony floors ride along with core**: track Symfony only where core's composer.json requires it — do not maintain a separate Symfony version track.

## Related corpus entries

- Change records carry floor-raise announcements per line (full text indexed).
- The security-verification companion doc (`drupal-validation-tooling/05`) explains the advisory scope boundary.
