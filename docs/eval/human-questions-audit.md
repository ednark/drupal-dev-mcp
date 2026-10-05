# Human-questions audit — how the index answers real community phrasings

First audit: 2026-10-05 (82 questions: DSE, SO-PHP, course scenarios, r/drupal).
Method: every question in
[`human-questions.json`](human-questions.json) runs through `search_drupal`
(hybrid, limit 5) exactly as an MCP client would; results classified by score
heuristic and manually compared against the community's accepted answers
(from the untracked raw harvest). Thresholds: covered ≥ 1.2, weak ≥ 0.8,
likely-gap ≥ 0.5, gap < 0.5. Re-run with `npm run index:audit-questions`.

## Aggregate

| Lane | Covered+weak | Notes |
|---|---|---|
| dse_classic (top-voted all-time) | 22/30 (73%) | Timeless phrasings; misses concentrate on D7-era APIs |
| dse_modern (most recent answered) | 14/25 (56%) | Hardest cohort: current-version, contrib-specific, hosting questions |
| php_general (SO PHP all-time top) | 9/12 (75%) | Problem types; php-manual + security skills carry most |
| course_scenario (study-guide objectives) | 4/5 (80%) | Small but high — curricula phrase like the guidance corpus |
| reddit (r/drupal question-like posts) | 5/10 (50%) | Discussion subreddit: misses are meta/career questions, not doc gaps |

Overall: 54/82 (66%) covered or weak; 28 flagged for review.

## Side-by-side: community answer vs our retrieval

| Question | Community (accepted answer, condensed) | Our top hits | Verdict |
|---|---|---|---|
| "What is the basic concept behind hooks?" | (unanswered in raw set) | *Understanding hooks* tutorial + *Subscribe to and dispatch events* (1.00) | **covered** — right pedagogy pair |
| "How should I implement hook_menu()?" | (classic; modern answers say "use the routing API") | MediaLinkTarget.php, noise (0.36) | **legit gap** — D7-era API; index intentionally serves D10/11 where hook_menu doesn't exist. Era-tag classic questions and don't count D7-API misses as corpus failures |
| "Cannot autowire service" errors | Fixed services.yml entries (class + logger channel + arguments) | Symfony `autowiring.rst` (1.12) + `service_container.rst` (0.91) | **covered** — retrieval lands on the exact mechanism the community fix used |
| Commerce Stripe "Stripe Connect" preferred method | Maintainer answer (Stripe's platform policy) | OnsitePaymentGatewayInterface.php (0.21), noise | **corpus gap** — module-policy question; the maintainer's answer isn't doc-derivable. Candidate: add commerce/payments contrib modules to the 73-module corpus |
| Batch API + Cloudflare 502 | (infrastructure troubleshooting) | BondTradingCaseStudy.md noise (0.29) | **out of scope by design** — closed-world index; hosting/CDN questions correctly unanswerable |
| "How can I prevent SQL injection in PHP?" | (classic; prepared statements) | Drupal injection-security skill (1.23) + php docs | **covered** — security corpus answers the PHP generalist |
| PHP symbols reference guide | (classic syntax reference) | templates.md, parse_ini_file (0.60) | **low-value gap** — php-manual corpus is API reference, not a syntax tutorial |

## Findings

1. **Identifier-free natural-language questions are the weak spot, as predicted by the tutor exercise.** module-code phase: 68% but only 2 *covered* (rest weak) — retrieval finds plausible material, an agent must pick among candidates.
2. **D7-era classics need era interpretation, not corpus fixes.** `hook_menu()` misses are correct behavior. The eval set should exclude (or separately flag) classic questions whose API no longer exists.
3. **Title-only queries understate real-world usability.** Questions like "How can I fix this fatal PHP Uncaught TypeError?" carry their payload in the body; a real MCP client (agent loop) would search with the error text and symbols — not the title. Next audit iteration should add body-derived queries for a subset.
4. **Contrib-specific policy questions are the main true corpus gap** (Commerce Stripe). Consider extending the contrib-module-code corpus toward payment/e-commerce modules if that domain matters.
5. **Deployment/config coverage is now strong** (config-deploy 100%) — the phase-8 remediation held.
6. **The guidance/skill corpora punch above their size**: they win on security, config, and general phrasing where canonical API docs can't match.
7. **Reddit's question style splits cleanly**: technical posts retrieve well ("cannot update core-recommend because of a Symfony security advisory" → Symfony `security.rst` 1.15; "What is Drupal.displace()?" → 1.10), while community-metacommentary ("Is Drupal having a renaissance?", career dilemmas) is unanswerable by a docs index **by design** — count such posts as N/A, not gaps.

## Recommended actions

- [ ] Era-filter classic questions whose subject API is D7-only when interpreting future audits.
- [ ] Add body-derived query variants for the ~10 title-only questions that carry specifics in their bodies.
- [ ] Candidate corpus extension: commerce/payments contrib modules (Stripe question was the clearest miss).
- [ ] Consider a small "routing API for hook_menu migrants" guidance doc — the classic→modern migration question recurs in the community.
- [x] Promote audited questions into `BENCHMARK_CASES` — done 2026-10-05: 5 human-phrased cases with unambiguous ground truth, verified in lexical mode (`regions in a theme`, `autowire service`, `Permanent Cache Bin/Memcache`, `custom exception subscriber`, `webform email handler`). Benchmark now 25 cases; the release gate is proportional (80%) instead of a fixed 16. The audit's hybrid-only winners were deliberately excluded — they pass via embeddings but fail lexical, and this gate runs lexical.