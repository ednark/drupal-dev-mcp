# Selecting hooks, events, or services

Intent: when adding behavior-reaction points in a custom module, choosing among hook implementations, event subscribers, and injected services.

Source: https://www.drupal.org/docs/develop/creating-modules

## Where it lives

All three live inside `modules/custom/<machine_name>/`: hooks in `<machine_name>.module` (and form/hook includes), subscribers registered under `services.yml` tagged `event_subscriber`, services registered normally and injected wherever used.

## Decision rules

1. Reacting to something Drupal documents as a **hook**? Implement the hook. Hooks remain Drupal's primary integration convention and cover entity/storage/form/theme lifecycles.
2. Same moment also dispatched as a **Symfony/event-driven** equivalent? Either works; prefer events for OO-testability when your codebase already services-based, hooks otherwise.
3. Logic reused across multiple trigger points? Put real implementation inside a **service**, and let hook/subscriber wrappers call it — one tested brain, thin adapters.
4. Form/control-panel tweaks → dedicated `hook_form_alter` family within same module naming rules.

## Trade-offs

- Hook-first code reads naturally against core documentation and requires no DI wiring; harder to unit test directly than service calls.
- Event subscribers test well but exist only where core dispatches named events; coverage gaps force hooks anyway.
- Services without adapter indirection couple every caller to instantiation details, complicating later change.
