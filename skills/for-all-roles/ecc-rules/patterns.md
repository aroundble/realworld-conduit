<!--
  Adapted from everything-claude-code at SHA 098b773 under MIT license.
  Source: https://github.com/affaan-m/everything-claude-code/blob/main/rules/common/patterns.md
  Changes: attribution header added; content otherwise verbatim.
-->

---
name: ecc-patterns
description: Use for meta-architectural choices: skeleton-project scaffolding, parallel agent evaluation, comparison-driven design. Ported from everything-claude-code.
---

# Common Patterns

## Skeleton Projects

When implementing new functionality:
1. Search for battle-tested skeleton projects
2. Use parallel agents to evaluate options:
   - Security assessment
   - Extensibility analysis
   - Relevance scoring
   - Implementation planning
3. Clone best match as foundation
4. Iterate within proven structure

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:
- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:
- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)
