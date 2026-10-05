# Human-phrased Drupal evaluation questions

Curated from real community sources on 2026-10-05. 72 questions.
This file mirrors [`human-questions.json`](human-questions.json), which `npm run index:audit-questions` consumes.
Questions are evaluation data only (short titles + links; community answers stay in the untracked raw harvest).

| Lane | Count | Origin |
|---|---|---|
| dse_classic | 30 | Drupal Stack Exchange top-voted all-time (timeless beginner phrasing) |
| dse_modern | 25 | Drupal Stack Exchange most recent answered questions (current-version phrasing) |
| php_general | 12 | Stack Overflow PHP all-time top (problem types, successor to the phpbuilder.net-era forums) |
| course_scenario | 5 | Course/curriculum objectives (GitHub: Acquia study guide, training repos) |

| Phase | Count |
|---|---|
| general | 23 |
| module-code | 19 |
| theming | 10 |
| forms | 7 |
| site-building | 4 |
| caching-perf | 3 |
| config-deploy | 3 |
| migrate-upgrade | 3 |

## Questions

| ID | Phase | Question | Source |
|---|---|---|---|
| dse-c-001 | site-building | What are the recommended directory permissions? | [link](https://drupal.stackexchange.com/questions/373/what-are-the-recommended-directory-permissions) |
| dse-c-002 | module-code | What is the basic concept behind hooks? | [link](https://drupal.stackexchange.com/questions/26290/what-is-the-basic-concept-behind-hooks) |
| dse-c-003 | site-building | Contextual filters taxonomy name | [link](https://drupal.stackexchange.com/questions/9332/contextual-filters-taxonomy-name) |
| dse-c-004 | module-code | How should I implement hook_menu()? | [link](https://drupal.stackexchange.com/questions/62473/how-should-i-implement-hook-menu) |
| dse-c-005 | module-code | How can I change a user's password from the command line using Drush? | [link](https://drupal.stackexchange.com/questions/2/how-can-i-change-a-users-password-from-the-command-line-using-drush) |
| dse-c-006 | theming | What are the downsides of using PHP Filter code in blocks, nodes, views-args, etc? | [link](https://drupal.stackexchange.com/questions/2509/what-are-the-downsides-of-using-php-filter-code-in-blocks-nodes-views-args-et) |
| dse-c-007 | caching-perf | Do non-enabled modules affect performance? | [link](https://drupal.stackexchange.com/questions/22/do-non-enabled-modules-affect-performance) |
| dse-c-008 | module-code | How to take a site offline using Drush? | [link](https://drupal.stackexchange.com/questions/16/how-to-take-a-site-offline-using-drush) |
| dse-c-009 | module-code | When is it appropriate to create an entity instead of a new content type? | [link](https://drupal.stackexchange.com/questions/22586/when-is-it-appropriate-to-create-an-entity-instead-of-a-new-content-type) |
| dse-c-010 | site-building | How do I get the current path alias or path? | [link](https://drupal.stackexchange.com/questions/106103/how-do-i-get-the-current-path-alias-or-path) |
| dse-c-011 | theming | Any way to add CSS for a single page/node? | [link](https://drupal.stackexchange.com/questions/126/any-way-to-add-css-for-a-single-page-node) |
| dse-c-012 | config-deploy | What does "The provided host name is not valid for this server" mean? | [link](https://drupal.stackexchange.com/questions/145286/what-does-the-provided-host-name-is-not-valid-for-this-server-mean) |
| dse-c-013 | config-deploy | Suggestions for settings.php - Local dev, Development server, Live server | [link](https://drupal.stackexchange.com/questions/9/suggestions-for-settings-php-local-dev-development-server-live-server) |
| dse-c-014 | module-code | How do I access a field value for an entity (e.g. node) object? | [link](https://drupal.stackexchange.com/questions/144947/how-do-i-access-a-field-value-for-an-entity-e-g-node-object) |
| dse-c-015 | module-code | How do I load a field collection from a node? | [link](https://drupal.stackexchange.com/questions/11062/how-do-i-load-a-field-collection-from-a-node) |
| dse-c-016 | module-code | How can I obscure what I am using to run my site? | [link](https://drupal.stackexchange.com/questions/237/how-can-i-obscure-what-i-am-using-to-run-my-site) |
| dse-c-017 | config-deploy | How can I import the configuration on a different site? | [link](https://drupal.stackexchange.com/questions/150481/how-can-i-import-the-configuration-on-a-different-site) |
| dse-c-018 | caching-perf | Given that db_select is much slower than db_query, why would I want to use it? | [link](https://drupal.stackexchange.com/questions/1200/given-that-db-select-is-much-slower-than-db-query-why-would-i-want-to-use-it) |
| dse-c-019 | general | How do I get the current node ID? | [link](https://drupal.stackexchange.com/questions/145823/how-do-i-get-the-current-node-id) |
| dse-c-020 | module-code | Print the query which is built using db_select() | [link](https://drupal.stackexchange.com/questions/51333/print-the-query-which-is-built-using-db-select) |
| dse-c-021 | general | How to get the base URL of a site | [link](https://drupal.stackexchange.com/questions/202810/how-to-get-the-base-url-of-a-site) |
| dse-c-022 | general | Rebuild images from image style | [link](https://drupal.stackexchange.com/questions/12864/rebuild-images-from-image-style) |
| dse-c-023 | theming | How to get the valid URL of a Link field from within a Twig template? | [link](https://drupal.stackexchange.com/questions/199262/how-to-get-the-valid-url-of-a-link-field-from-within-a-twig-template) |
| dse-c-024 | theming | Better understanding of Drupal behaviors | [link](https://drupal.stackexchange.com/questions/11756/better-understanding-of-drupal-behaviors) |
| dse-c-025 | theming | How do I create custom regions in a theme? | [link](https://drupal.stackexchange.com/questions/129/how-do-i-create-custom-regions-in-a-theme) |
| dse-c-026 | migrate-upgrade | How to upgrade only core with drush? | [link](https://drupal.stackexchange.com/questions/133796/how-to-upgrade-only-core-with-drush) |
| dse-c-027 | module-code | How to programmatically create Fields? | [link](https://drupal.stackexchange.com/questions/8284/how-to-programmatically-create-fields) |
| dse-c-028 | module-code | What are Ctools plugin (content type, access, etc), and how does one create them? | [link](https://drupal.stackexchange.com/questions/33336/what-are-ctools-plugin-content-type-access-etc-and-how-does-one-create-them) |
| dse-c-029 | module-code | Getting the image URL from a field_image on a node | [link](https://drupal.stackexchange.com/questions/137319/getting-the-image-url-from-a-field-image-on-a-node) |
| dse-c-030 | forms | Is it possible to replace more than one form element (wrappers) triggered by only one #ajax trigger element? | [link](https://drupal.stackexchange.com/questions/8529/is-it-possible-to-replace-more-than-one-form-element-wrappers-triggered-by-onl) |
| dse-m-001 | forms | schedule webform close date based on parent node field | [link](https://drupal.stackexchange.com/questions/323437/schedule-webform-close-date-based-on-parent-node-field) |
| dse-m-002 | theming | How can I run the same JavaScript code on both themes (admin theme and website theme)? | [link](https://drupal.stackexchange.com/questions/323428/how-can-i-run-the-same-javascript-code-on-both-themes-admin-theme-and-website-t) |
| dse-m-003 | module-code | How can I fix this fatal PHP Uncaught TypeError? | [link](https://drupal.stackexchange.com/questions/323427/how-can-i-fix-this-fatal-php-uncaught-typeerror) |
| dse-m-004 | module-code | How can I fix these "Cannot autowire service" errors? | [link](https://drupal.stackexchange.com/questions/323426/how-can-i-fix-these-cannot-autowire-service-errors) |
| dse-m-005 | module-code | Supporting multiple payment gateways with their own checkout flow plugins | [link](https://drupal.stackexchange.com/questions/323422/supporting-multiple-payment-gateways-with-their-own-checkout-flow-plugins) |
| dse-m-006 | migrate-upgrade | Trying to upgrade from 10.6 to 11.3 using composer but it always upgrades to 11.4 which cuases issues | [link](https://drupal.stackexchange.com/questions/323400/trying-to-upgrade-from-10-6-to-11-3-using-composer-but-it-always-upgrades-to-11) |
| dse-m-007 | theming | Where is the twig that controls list items? | [link](https://drupal.stackexchange.com/questions/323390/where-is-the-twig-that-controls-list-items) |
| dse-m-008 | general | How to disable or efficiently override Drupal core's styling on off-canvas Ajax dialogs? | [link](https://drupal.stackexchange.com/questions/323388/how-to-disable-or-efficiently-override-drupal-cores-styling-on-off-canvas-ajax) |
| dse-m-009 | general | Refund after cancellation not procesed | [link](https://drupal.stackexchange.com/questions/323380/refund-after-cancellation-not-procesed) |
| dse-m-010 | theming | How to set a custom path in a custom route when the controller needs to return rendered content | [link](https://drupal.stackexchange.com/questions/323374/how-to-set-a-custom-path-in-a-custom-route-when-the-controller-needs-to-return-r) |
| dse-m-011 | forms | webform email handler does not allow certain roles in to field | [link](https://drupal.stackexchange.com/questions/323373/webform-email-handler-does-not-allow-certain-roles-in-to-field) |
| dse-m-012 | general | Why is Commerce Stripe "Stripe Connect" labeled as "preferred" method of authorization? | [link](https://drupal.stackexchange.com/questions/323371/why-is-commerce-stripe-stripe-connect-labeled-as-preferred-method-of-authori) |
| dse-m-013 | theming | What file is included with include('bootstrap:menu_main')? | [link](https://drupal.stackexchange.com/questions/323355/what-file-is-included-with-includebootstrapmenu-main) |
| dse-m-014 | caching-perf | Permanent Cache Bin and Memcache | [link](https://drupal.stackexchange.com/questions/323337/permanent-cache-bin-and-memcache) |
| dse-m-015 | forms | webform access based on role negation | [link](https://drupal.stackexchange.com/questions/323320/webform-access-based-on-role-negation) |
| dse-m-016 | module-code | view mode and storage entity | [link](https://drupal.stackexchange.com/questions/323318/view-mode-and-storage-entity) |
| dse-m-017 | forms | extract one number field from a view with a relation for use in a webform | [link](https://drupal.stackexchange.com/questions/323317/extract-one-number-field-from-a-view-with-a-relation-for-use-in-a-webform) |
| dse-m-018 | module-code | taxonomy or storage entity to join two tables | [link](https://drupal.stackexchange.com/questions/323303/taxonomy-or-storage-entity-to-join-two-tables) |
| dse-m-019 | forms | Customize webform progress tracker steps | [link](https://drupal.stackexchange.com/questions/323286/customize-webform-progress-tracker-steps) |
| dse-m-020 | migrate-upgrade | Why am I getting Forbidden after the upgrade? | [link](https://drupal.stackexchange.com/questions/323281/why-am-i-getting-forbidden-after-the-upgrade) |
| dse-m-021 | general | Create inline link to display PDF | [link](https://drupal.stackexchange.com/questions/323265/create-inline-link-to-display-pdf) |
| dse-m-022 | forms | date_ical geo format | [link](https://drupal.stackexchange.com/questions/323252/date-ical-geo-format) |
| dse-m-023 | module-code | Certain batch functions do not work with Cloudflare and return 502 Bad Gateway | [link](https://drupal.stackexchange.com/questions/323251/certain-batch-functions-do-not-work-with-cloudflare-and-return-502-bad-gateway) |
| dse-m-024 | general | Custom exception subscriber does not handle PHP errors | [link](https://drupal.stackexchange.com/questions/323244/custom-exception-subscriber-does-not-handle-php-errors) |
| dse-m-025 | site-building | Show alternate emails for certain roles | [link](https://drupal.stackexchange.com/questions/322241/show-alternate-emails-for-certain-roles) |
| php-c-001 | general | Reference Guide: What does this symbol mean in PHP? (PHP Syntax) | [link](https://stackoverflow.com/questions/3737139/reference-guide-what-does-this-symbol-mean-in-php-php-syntax) |
| php-c-002 | general | Deleting an element from an array in PHP | [link](https://stackoverflow.com/questions/369602/deleting-an-element-from-an-array-in-php) |
| php-c-003 | module-code | How do I get a YouTube video thumbnail from the YouTube API? | [link](https://stackoverflow.com/questions/2068344/how-do-i-get-a-youtube-video-thumbnail-from-the-youtube-api) |
| php-c-004 | general | How can I prevent SQL injection in PHP? | [link](https://stackoverflow.com/questions/60174/how-can-i-prevent-sql-injection-in-php) |
| php-c-005 | general | Why shouldn't I use mysql_* functions in PHP? | [link](https://stackoverflow.com/questions/12859942/why-shouldnt-i-use-mysql-functions-in-php) |
| php-c-006 | general | How do I check if a string contains a specific word? | [link](https://stackoverflow.com/questions/4366730/how-do-i-check-if-a-string-contains-a-specific-word) |
| php-c-007 | general | How do you parse and process HTML/XML in PHP? | [link](https://stackoverflow.com/questions/3577641/how-do-you-parse-and-process-html-xml-in-php) |
| php-c-008 | general | How does PHP 'foreach' actually work? | [link](https://stackoverflow.com/questions/10057671/how-does-php-foreach-actually-work) |
| php-c-009 | general | When should I use 'self' over '$this'? | [link](https://stackoverflow.com/questions/151969/when-should-i-use-self-over-this) |
| php-c-010 | general | How do I get PHP errors to display? | [link](https://stackoverflow.com/questions/1053424/how-do-i-get-php-errors-to-display) |
| php-c-011 | theming | How Can I add HTML And CSS Into PDF | [link](https://stackoverflow.com/questions/391005/how-can-i-add-html-and-css-into-pdf) |
| php-c-012 | general | str_starts_with and str_ends_with functions in PHP | [link](https://stackoverflow.com/questions/834303/str-starts-with-and-str-ends-with-functions-in-php) |
| course-001 | general | This study guide used in tandem with the 'Drupal 8 Certification Crash Course': | [link](https://github.com/WidgetsBurritos/d8-studyguide) |
| course-002 | general | Developer Certification Study Guide is an updated version of https://github.com/WidgetsBurritos/d8-studyguide. | [link](https://github.com/WebFirstInc/drupalstudyguide) |
| course-003 | general | Why Drupal is a popular choice for building websites? ## | [link](https://github.com/kuldeepmehra27/drupal-learning-path) |
| course-004 | general | There are several reasons why Drupal is a popular choice for building websites: | [link](https://github.com/kuldeepmehra27/drupal-learning-path) |
| course-005 | general | If you're new to Drupal, here are some steps you can follow to start learning about this powerful content management sys | [link](https://github.com/kuldeepmehra27/drupal-learning-path) |
