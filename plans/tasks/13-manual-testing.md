---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 13: Manual Testing Pass

## Depends On
- Task 12: Client Integration (tool visible in Claude Desktop or Cursor, LanceDB table populated)
- Task 11: Tool Handler (full pipeline implemented)

## Goal
Execute a structured manual testing pass against all 10 test questions from the MVP plan, record results, and determine whether the MVP acceptance criteria are met. This is the final gate before calling the project "done." Issues discovered here may require iteration on the system prompt (Task 11), chunking parameters (Task 07), or ETL coverage (Tasks 04–06) — the task file documents those tuning levers. The MVP is complete when at least 8 of 10 questions pass and no hallucinated API names appear in any response.

## Deliverables
- `tests/manual-test-questions.md` fully filled in — every question marked ✅ or ❌ with notes
- At least 8 of 10 questions passing all five acceptance criteria
- Out-of-scope question (Nginx config) returns a graceful "not in context" reply
- Version-filter test documented (question 5 with `drupal_version: "10.x"` vs `"11.x"`)
- ETL re-run confirms no duplicate LanceDB rows
- Final commit capturing test results + any tuning made

## Acceptance Criteria per Question

A response **passes** if ALL five conditions hold:

1. ✅ **Correct API names** — no hallucinated hook names, class names, service IDs, or YAML keys
2. ✅ **Working code** — any PHP, YAML, or `services.yml` snippet uses real Drupal 10/11 API (not deprecated Drupal 7/8 patterns)
3. ✅ **Cited sources** — at least one `[Source N]` reference in the body and a `## Sources` section at the end
4. ✅ **No contradictions** — nothing in the response contradicts the official drupal.org documentation
5. ✅ **Speed** — response delivered in under 5 seconds from question submission to Markdown output

A response **fails** if ANY of the following occur:
- ❌ Invents a function name, hook name, or service tag that does not exist in Drupal
- ❌ Cites a symbol name that cannot be found on api.drupal.org
- ❌ Says "I don't have information" when the answer is clearly covered by the corpus
- ❌ Takes more than 5 seconds end-to-end

## 10 Test Questions + Ground Truth

For each question: ask it in Claude Desktop / Cursor using the `ask_drupal_expert` tool, then evaluate the response against the criteria above.

### Q1 — Custom Access Checker as Tagged Service
> "How do I implement a custom access checker as a tagged service?"

**Ground truth**: Must mention `AccessCheckInterface`, `applies()` and `access()` methods,
`services.yml` tag `access_check`, and registration under the `drupal.access_manager`.

**Specific checks**:
- [ ] Mentions `AccessCheckInterface` (not a hallucinated class)
- [ ] Shows `services.yml` with `tags: [{ name: access_check }]`
- [ ] References routing (`_custom_access` in `routing.yml`)

---

### Q2 — `hook_entity_presave()`
> "What is the correct way to use `hook_entity_presave()` to alter a node before saving?"

**Ground truth**: Hook signature `hook_entity_presave(EntityInterface $entity)`, checking `$entity instanceof NodeInterface`, and using `$entity->set()` for field changes.

**Specific checks**:
- [ ] Correct hook name: `hook_entity_presave` (not `hook_node_presave` — though that also exists)
- [ ] Uses `EntityInterface` type hint
- [ ] Shows `instanceof` check before casting

---

### Q3 — Plugin System and Annotations
> "How does the Drupal plugin system work and what are plugin annotations?"

**Ground truth**: Plugin manager, plugin types, `@Plugin` annotation syntax, `@Annotation` base class, discovery via annotation or YAML, `PluginManagerInterface`.

**Specific checks**:
- [ ] Mentions `PluginManagerBase` or `DefaultPluginManager`
- [ ] Shows annotation syntax (e.g., `@Block`, `@Field`)
- [ ] Correctly describes annotation-based discovery

---

### Q4 — Custom Config Entity with Schema
> "How do I define a custom config entity type with a schema?"

**Ground truth**: `@ConfigEntityType` annotation, `ConfigEntityBase`, `config/schema/modulename.schema.yml`, `config/install/` for default config.

**Specific checks**:
- [ ] Mentions `ConfigEntityBase`
- [ ] Shows the schema YAML with correct type declarations
- [ ] Mentions `config/install/` directory

---

### Q5 — Load Entities by Field Value + Version Filter
> "How do I load multiple entities by field value without using the Database API directly?"

**Ground truth**: `\Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['field_name' => $value])` or the newer `EntityQuery` approach.

**Specific checks**:
- [ ] Mentions `loadByProperties()` or `EntityQuery`
- [ ] Does NOT suggest raw SQL or `db_select()`
- [ ] Code uses Drupal 10/11 patterns (not Drupal 7 `entity_load_multiple_by_properties`)

**Version filter test**: Ask this question twice:
```
Once with drupal_version: "10.x"
Once with drupal_version: "11.x"
```
Document whether results differ. They may be similar (API is stable) or slightly different.

---

### Q6 — Cache Tags for Node Content
> "What cache tags should I use when rendering content that depends on a specific node?"

**Ground truth**: `node:NID` cache tag, `Cache::mergeTags()`, `CacheableMetadata`, `addCacheTags()`. Entity-level tags like `node_list` for queries.

**Specific checks**:
- [ ] Mentions `node:NID` tag format (not a made-up tag)
- [ ] References `CacheableMetadata` or `#cache` render array key
- [ ] Does NOT use deprecated `drupal_add_cache()`

---

### Q7 — Custom Route with Dynamic Parameter
> "How do I create a custom route with a dynamic parameter and access checking?"

**Ground truth**: `modulename.routing.yml` with `{parameter}` placeholder, `_controller`, `_access` or `_custom_access`, `ParamConverter` for upcasting.

**Specific checks**:
- [ ] Shows `routing.yml` with `{param}` in the path
- [ ] Mentions `_controller` and `_access` / `_custom_access`
- [ ] References `RouteMatchInterface` in controller signature

---

### Q8 — Migrate Source Plugin vs Process Plugin
> "What is the difference between a source plugin and a process plugin in Drupal Migrate?"

**Ground truth**: Source plugin provides raw data rows (`SourcePluginBase`, `@MigrateSource`); process plugin transforms individual field values (`ProcessPluginBase`, `@MigrateProcessPlugin`).

**Specific checks**:
- [ ] Correctly distinguishes source (`@MigrateSource`) from process (`@MigrateProcessPlugin`)
- [ ] Mentions `getIds()` as source plugin requirement
- [ ] Shows example of a process plugin (e.g., `get`, `default_value`)

---

### Q9 — Event Subscriber
> "How do I subscribe to a Drupal event using an event subscriber class?"

**Ground truth**: `EventSubscriberInterface`, `getSubscribedEvents()` static method, `services.yml` tag `event_subscriber`, Symfony event system.

**Specific checks**:
- [ ] Shows `implements EventSubscriberInterface`
- [ ] Shows correct `getSubscribedEvents()` return format
- [ ] Shows `services.yml` with `tags: [{ name: event_subscriber }]`

---

### Q10 — `hook_form_alter()` with Custom Validator
> "How do I use `hook_form_alter()` to add a custom validator to an existing form?"

**Ground truth**: `hook_form_alter(array &$form, FormStateInterface $form_state, $form_id)`, `$form['#validate'][] = 'my_validator'`, validator function signature `my_validator(array &$form, FormStateInterface $form_state)`.

**Specific checks**:
- [ ] Correct hook signature with `&$form` by reference
- [ ] Uses `FormStateInterface` (not the Drupal 7 `$form_state` array)
- [ ] Shows validator function signature

---

## Additional Validation Checks

Run these after all 10 questions:

### Out-of-scope test
Ask: "How do I configure Nginx for a Drupal site?"

**Expected**: Response should say something like "The provided documentation context does not contain information about Nginx configuration" — NOT a hallucinated Nginx config.

Mark: ✅ graceful refusal | ❌ hallucinated answer

### Duplicate check (re-run ETL)
```bash
# Run ETL a second time to confirm full-reload doesn't leave stale data
npm run etl:drupal-core-docs

# Check count — should be same as before (loader drops and recreates the table)
npx ts-node -e "
require('dotenv').config();
const lancedb = require('@lancedb/lancedb');
async function check() {
  const db = await lancedb.connect(process.env.LANCEDB_PATH ?? './data/lancedb');
  const table = await db.openTable('drupal_core_docs');
  const n = await table.countRows();
  console.log('After re-run row count:', n);
}
check();
"
```

> **Note**: The LanceDB loader drops and recreates the table on every run — there is no risk of duplication. The re-run test validates that the count is consistent and the table is still queryable.

### Cold restart test
LanceDB is fully embedded — there is nothing to stop or restart.
1. Restart Claude Desktop (or Cursor)
2. Ask Q1 again — must work without any manual intervention
3. No Docker commands or server restart needed

## Tuning Levers (if results are poor)

If too many questions fail, try these adjustments before re-testing:

**Low retrieval accuracy** (relevant context not in top 10):
- Increase `nResults` in `vectorSearch()` from 10 to 15 or 20
- Check collection count — if < 10,000 docs, re-run ETL and verify parser output

**Hallucinations despite good context**:
- Add this line to `SYSTEM_PROMPT`: "If you are not 100% certain a class, hook, or service ID exists, prefix it with 'Possibly:' rather than stating it as fact."
- Lower `temperature` from 0.2 to 0.1

**Response too generic / not citing specific sources**:
- Add to system prompt: "Always cite the specific class name, file path, or section from the source material."
- Check that `symbol_name` and `section` metadata are correctly populated in LanceDB (spot-check by querying a few rows: `table.search([...]).limit(5).toArray()`)

**User Guide answers appearing for API questions**:
- In `vectorSearch()`, add a logic branch: if the question contains "hook_", "Interface", or "::class", add `where: { source: 'drupal_phpdoc' }` as a pre-filter

**Response exceeds 5 seconds**:
- Switch `OPENAI_SYNTHESIS_MODEL` to `gpt-4o-mini` (much faster)
- Reduce `nResults` from 10 to 5

## Verification / Done Criteria

Fill in `tests/manual-test-questions.md` and confirm:
- ✅ at least **8 of 10** questions pass all five acceptance criteria
- ✅ out-of-scope question (Nginx) returns graceful refusal
- ✅ version filter test documented for Q5
- ✅ ETL re-run produces consistent row count (no duplication — loader drops and recreates table)
- ✅ cold restart test passes

When all criteria are met, update `tests/manual-test-questions.md` with final results and commit:
```bash
git add tests/manual-test-questions.md
git commit -m "test: manual testing pass complete — MVP acceptance criteria met"
```

Then update `README.md` to include the test date and result summary.

**The MVP is complete.**

## Notes / Gotchas

- **5-second SLA**: The 5-second target covers embedding the question + LanceDB vector search + GPT-4o generation. The LanceDB query runs in-process (no network hop), so it is very fast (~10–50ms). The dominant latency is GPT-4o generation. On a fast laptop with good network, total time is typically 2–4 seconds. If you consistently exceed 5 seconds, switch to `gpt-4o-mini` for synthesis.
- **Ground truth URLs**: The ground truth URLs in the MVP plan (e.g., `api.drupal.org/...`) are for reference — the tool does not fetch live URLs. The verification is whether the symbol names and API patterns are correct, not whether the URLs resolve.
- **Q5 version filter may show same results**: The Drupal entity loading API (`loadByProperties`, `EntityQuery`) has been stable across Drupal 9/10/11. If both version filters return similar results, that is correct behavior — not a bug.
- **Documenting failures**: Even if a question fails, document WHY it failed (wrong class name, missing code snippet, timeout) in the notes column. This guides future iteration.
- **Re-testing after tuning**: If you adjust the system prompt or `nResults`, re-test the subset of questions that failed — you do not need to re-test all 10 from scratch.
