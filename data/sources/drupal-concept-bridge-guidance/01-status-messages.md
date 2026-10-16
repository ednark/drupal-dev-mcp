# Showing a status message, notice, or warning to the user

## The question callers ask

- "How do I show a status message to the user?"
- "How do I display a confirmation message after saving a form?"
- "How do I show a green success message / a warning message / an error message?"
- "How do I notify the user from custom module code?"
- "How do I give the user feedback (a flash message) after an action?"

## The Drupal system: the Messenger service (`messenger`)

Since Drupal 8, user-facing messages are set through the **Messenger
service**. In Drupal 10/11 there is no procedural function anymore — the
Drupal 7-era `drupal_set_message()` was removed and is a legacy-API trap.

```php
// Procedural (non-injected code):
\Drupal::messenger()->addStatus($this->t('Saved.'));
\Drupal::messenger()->addWarning($this->t('Check your settings.'));
\Drupal::messenger()->addError($this->t('Something went wrong.'));

// Injected service (preferred in classes): the alias is 'messenger'.
// In a FormBase or ControllerBase, use $this->messenger() from the
// MessengerTrait, or type-hint Drupal\Core\Messenger\MessengerInterface.
```

Message severities map to Drupal's message CSS classes: `status` (green),
`warning` (yellow), `error` (red). Messages render in the `highlighted`
region of the active theme.

## Decision rules

- Message tied to a form submission? Set it from the form's submit handler;
  the messenger is available via `$this->messenger()` on FormBase.
- Message tied to a route/controller response? Prefer adding it from the
  controller, or attach a status message as part of a redirect response.
- Repeating per-request messages that a third party should be able to
  alter? Events and hooks cannot remove messages; keep messenger calls in
  your own code paths.
- If you find `drupal_set_message()` in old code: it is gone — replace with
  the messenger service.

## Citations

- Messenger API: https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Messenger!MessengerInterface.php/interface/MessengerInterface
- Creating modules handbook (services and dependency injection):
  https://www.drupal.org/docs/develop/creating-modules
- Change records for the messenger service introduction:
  https://www.drupal.org/list-changes (search: messenger)
