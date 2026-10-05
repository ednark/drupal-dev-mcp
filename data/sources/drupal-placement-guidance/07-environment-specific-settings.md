# Environment-specific differences

Intent: deciding where per-environment values and behavior differences live (dev vs stage vs production).

Source: https://www.drupal.org/docs/administering-a-site/configuration-management

## Where it lives

- **`settings.php` / `sites/default/settings.<env>.php`** — databases, API keys, reverse-proxy/cache backend toggles, trusted host patterns, environment identity flags.
- **Split configs** — full or partial config split modules/selectors handle structural YAML that legitimately differs per environment (e.g. enabling shield or mailtrap on non-prod).
- **Never exported global config** for credentials.
- **`.env`-style secrets** outside repo via deployment tooling when hosting platform supports it.

## Decision rules

1. Value differs because the environment has different infrastructure (DB host, SMTP relay, CDN keys)? → settings.php include.
2. Whole feature/config objects differ per env? → config split, exported intentionally.
3. Same feature should behave differently by env at runtime? → code reads `Settings::get()`/environment flag set in settings.php.
4. Anything secret stays out of git regardless of mechanism.

## Trade-offs

- Splits add cognitive load to deployments but keep config imports deterministic.
- Divergent `settings*.php` files drift silently; template them from a documented baseline and review changes as code.
