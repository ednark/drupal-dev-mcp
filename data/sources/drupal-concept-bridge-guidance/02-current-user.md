# Getting the currently logged-in user

## The question callers ask

- "How do I get the currently logged-in user in custom module code?"
- "How do I get the current user account / the session user?"
- "How do I find out who is viewing the page?"
- "How do I get the logged-in user's ID or roles?"

## The Drupal system: the `current_user` service (`\Drupal::currentUser()`)

Since Drupal 8, the active user is a service: **`current_user`**, returning a
`Drupal\Core\Session\AccountProxyInterface` (the "current user account
proxy"). There is no `global $user` in Drupal 8+ code — that is a
Drupal 7-era trap, along with `$user->uid`.

```php
// Procedural (non-injected code):
$account = \Drupal::currentUser();
$uid = $account->id();                 // 0 for anonymous
$name = $account->getAccountName();
$isAnon = $account->isAnonymous();
$isAdmin = $account->hasPermission('administer site configuration');
$roles = $account->getRoles();

// Injected (preferred in classes): type-hint
// Drupal\Core\Session\AccountInterface (or AccountProxyInterface).
// The service alias is 'current_user'.
```

Load the full user entity only when you need fields beyond the account
proxy: `Drupal::entityTypeManager()->getStorage('user')->load($account->id())`.

## Decision rules

- Need identity/permissions inside a service? Inject `current_user`.
- Need the user as an entity (fields, profiles)? Load it via the entity
  storage with the proxy's id.
- Working outside a request scope (cron, queue, Drush)? `\Drupal::currentUser()`
  returns the anonymous account by default; `AccountSwitcher` (or
  `Drupal::service('account_switcher')->switchTo()`) scopes a different user.
- In Drupal 7 code you are porting: `global $user` and `$user->uid` are
  gone — replace with the `current_user` service.

## Citations

- current_user service / AccountProxy:
  https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Session!AccountProxy.php/class/AccountProxy
- User account API docs: https://www.drupal.org/docs/drupal-apis
- Creating modules handbook (services and dependency injection):
  https://www.drupal.org/docs/develop/creating-modules
