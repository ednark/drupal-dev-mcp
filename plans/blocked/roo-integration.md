---
status: blocked
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

That simplifies things nicely — it's a knowledge/reference tool rather than a site-manipulation tool. The strategy shifts to: make Roo consult that tool *before* writing any Drupal code or making architectural decisions, essentially treating it as a mandatory documentation lookup step.

Here's a tailored setup:

**`.roomodes`**

```yaml
customModes:
  - slug: drupal-dev
    name: "🐘 Drupal Developer"
    roleDefinition: >-
      You are an expert Drupal 10/11 developer and site builder.
      You have access to an MCP tool called ask_a_drupal_developer
      that returns relevant Drupal documentation and example code.
      You MUST call this tool before writing or suggesting any 
      Drupal code, module configuration, theming approach, or 
      architectural decision. Never rely on your training data 
      alone for Drupal-specific APIs, hooks, services, or config 
      patterns — always verify against the tool's documentation 
      first. Treat ask_a_drupal_developer as your authoritative 
      reference.
    whenToUse: >-
      Use for any Drupal development, site building, theming, 
      module development, or configuration task.
    customInstructions: >-
      See .clinerules-drupal-dev for detailed lookup rules.
    groups:
      - read
      - edit
      - command
      - mcp
```

**`.clinerules-drupal-dev`**

```markdown
# Drupal Developer Mode — MCP Lookup Rules

## The ask_a_drupal_developer Tool

You have ONE critical MCP tool: `ask_a_drupal_developer`
It returns Drupal documentation and example code.

## WHEN TO CALL IT (mandatory — do not skip)

Call ask_a_drupal_developer BEFORE you:
- Write or modify any .module, .theme, .install, or .php file
- Create or edit a Twig template
- Suggest a hook implementation
- Reference a Drupal service or plugin
- Propose a render array, form API structure, or field formatter
- Recommend a contributed module
- Write or modify a Views handler, config schema, or routing file
- Build an entity query or config management workflow
- Set up a migration or update hook

## HOW TO QUERY IT

Write specific, targeted queries. Examples:
- "How to create a custom block plugin in Drupal 10"
- "Form API #ajax callback example"
- "How to add a custom field formatter"
- "hook_entity_presave example for nodes"
- "Drupal 11 service dependency injection in controllers"
- "Twig template override for node--article.html.twig"
- "Config schema for a custom module settings form"

Bad queries (too vague):
- "Drupal modules"
- "How does Drupal work"

## MULTIPLE LOOKUPS ARE FINE

If a task touches multiple Drupal subsystems (e.g., creating a 
module that has a block plugin, a config form, AND a Twig template), 
call the tool multiple times with specific queries for each part.

## HOW TO USE THE RESULTS

- Base your code on the returned examples, adapting to the user's 
  specific needs
- If the documentation shows a different approach than what you 
  would have written from memory, prefer the documentation
- Cite what the tool returned when explaining your approach, 
  e.g., "Based on the Drupal docs, the recommended pattern is..."
- If the tool returns nothing useful, say so and note that your 
  response is based on general knowledge

## WORKFLOW

1. User asks for something Drupal-related
2. Identify which Drupal APIs/systems are involved
3. Call ask_a_drupal_developer for each relevant topic
4. Review the returned docs and examples
5. Write your code/config based on the documentation
6. Explain your approach, referencing what the tool returned

## DO NOT

- Write Drupal code "from memory" without consulting the tool first
- Assume hook signatures, service names, or plugin annotations 
  without verification
- Skip the lookup because "this is basic Drupal stuff"
- Hallucinate function names or parameters — verify them
```

Then in your MCP settings, auto-approve it since it's read-only:

```json
{
  "mcpServers": {
    "drupal-docs": {
      "command": "your-server-command-here",
      "args": ["your-args-here"],
      "alwaysAllow": ["ask_a_drupal_developer"]
    }
  }
}
```

The `alwaysAllow` is especially important here — without it, Roo will ask for your approval on every single lookup, which gets tedious fast when the whole point is frequent, automatic consultation.

The core idea is making the tool call a *reflex* rather than a fallback. The `.clinerules` file hammers on "call it BEFORE you write code" because LLMs naturally want to just generate from training data. The explicit workflow (identify → lookup → review → write → explain) gives it a concrete process to follow rather than a vague suggestion to "use the tool when helpful."