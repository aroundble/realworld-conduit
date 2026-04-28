---
name: pytest-bdd-pattern
description: Use when writing or reviewing BDD scenarios for a Python service. Maps the planner's Given/When/Then issue AC to pytest-bdd feature files and step definitions, with httpx and Playwright (where UI exists) as the boundary drivers. Deploy-mode agnostic — same spec runs against docker compose (local-only) or a dev URL (cloud).
---

# Skill — pytest-bdd pattern for Python services

**For**: generator (authors) + evaluator (re-runs live).
**Applies when**: Python stack is enabled and the issue's AC is
Given/When/Then (per
`skills/for-all-roles/bdd-acceptance-scenarios.md`).

## Why pytest-bdd

Keeps the planner's scenario syntax — literal Gherkin —
executable without retyping. The evaluator reads the issue AC
and the `.feature` file and they match character-for-character.
Traceability is grep-able.

## Install

Already covered by `python-reproducible-env.md`:

```toml
[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "pytest-bdd>=7.3",
    "httpx>=0.28",
]
```

## Directory layout

```
tests/
  bdd/
    features/
      guardrails.feature          # 1 file per issue/feature group
    steps/
      guardrail_steps.py          # step definitions
    conftest.py                   # shared fixtures (token, client)
```

## The .feature file = the issue AC

Copy-paste from the planner's issue directly:

```gherkin
# tests/bdd/features/guardrails.feature
Feature: Guardrail rules enforce immediately
  # Issue #47

  Background:
    Given an admin bearer token for tenant "t1"

  Scenario: Admin registers a new guardrail and it takes effect immediately
    Given no "profanity" guardrail exists for tenant "t1"
    When the admin POSTs to "/guardrails" with name "profanity" severity "block"
    Then the response status is 201
    And a subsequent POST to "/chat" containing profanity returns 403
    And the rejection reason is "profanity (severity=block)"

  Scenario: A rule with no severity set cannot be saved
    When the admin POSTs to "/guardrails" with name "test" severity ""
    Then the response status is 422
    And the error field for "severity" says "field required"
```

## The step file

```python
# tests/bdd/steps/guardrail_steps.py
import httpx
import pytest
from pytest_bdd import given, when, then, parsers, scenarios

scenarios("../features/guardrails.feature")

@pytest.fixture
async def client() -> httpx.AsyncClient:
    async with httpx.AsyncClient(base_url="http://api:8000") as c:
        yield c

@pytest.fixture
def ctx() -> dict:
    return {}

@given(parsers.parse('an admin bearer token for tenant "{tenant}"'))
def admin_token(ctx: dict, tenant: str):
    ctx["token"] = f"Bearer test-admin-{tenant}"
    ctx["tenant"] = tenant

@given(parsers.parse('no "{name}" guardrail exists for tenant "{tenant}"'))
async def no_guardrail(client: httpx.AsyncClient, ctx: dict, name: str, tenant: str):
    await client.delete(
        f"/guardrails/{name}",
        headers={"Authorization": ctx["token"]},
    )

@when(parsers.parse(
    'the admin POSTs to "/guardrails" with name "{name}" severity "{severity}"'
))
async def post_guardrail(client: httpx.AsyncClient, ctx: dict, name: str, severity: str):
    ctx["resp"] = await client.post(
        "/guardrails",
        json={"name": name, "severity": severity} if severity else {"name": name},
        headers={"Authorization": ctx["token"]},
    )

@then(parsers.parse("the response status is {status:d}"))
def response_status(ctx: dict, status: int):
    assert ctx["resp"].status_code == status, ctx["resp"].text

@then(parsers.parse(
    'a subsequent POST to "/chat" containing profanity returns {status:d}'
))
async def chat_blocked(client: httpx.AsyncClient, ctx: dict, status: int):
    r = await client.post(
        "/chat",
        json={"message": "damn profanity here"},
        headers={"Authorization": ctx["token"]},
    )
    ctx["chat_resp"] = r
    assert r.status_code == status

@then(parsers.parse('the rejection reason is "{reason}"'))
def rejection_reason(ctx: dict, reason: str):
    assert ctx["chat_resp"].json()["reason"] == reason

@then(parsers.parse('the error field for "{field}" says "{msg}"'))
def field_error(ctx: dict, field: str, msg: str):
    errors = {e["loc"][-1]: e["msg"] for e in ctx["resp"].json()["detail"]}
    assert errors.get(field, "").startswith(msg)
```

Rules:

- **One step-definition file per feature file.** Shared steps
  live in `conftest.py` or a shared `steps/common.py`.
- **No network calls in `@given`.** Given is preconditions —
  seed state, fixture wiring. Real HTTP belongs in `@when`.
- **No assertions in `@when`.** When is the action; Then is the
  assertion. Mixing them blurs Given/When/Then semantics.
- **One assertion per `@then` step.** Matches the "one
  observable per Then" rule from the BDD skill.

## Running against live compose

```bash
# 1. Bring the stack up.
docker compose up -d --build

# 2. Wait for healthy (project script).
./scripts/wait-for-healthy.sh

# 3. Run bdd from the host — client points at compose-exposed port.
uv run pytest tests/bdd --html=tests/e2e/test-results/local/latest/bdd.html

# Or from inside a sidecar test container that shares the docker network:
docker compose run --rm test-runner uv run pytest tests/bdd
```

The `--html` output plugs into `skills/ops/test-reports-layout.md`
for evaluator consumption.

## UI + backend: Playwright takes over

When the issue's scenarios touch a browser (admin console,
end-user UI), the BDD boundary is Playwright, not httpx.
`pytest-bdd` can drive Playwright via `pytest-playwright`:

```python
@when(parsers.parse('the admin opens the Guardrails page'))
async def open_guardrails(page, ctx):
    await page.goto(f"{ctx['base_url']}/admin/guardrails")

@then(parsers.parse('the new rule appears in the rules table within 2 seconds'))
async def rule_visible(page, ctx):
    await page.get_by_role("row", name="profanity").wait_for(timeout=2000)
    await page.screenshot(
        path=f"tests/e2e/screenshots/{ctx['issue']}/rule-appears.desktop.png",
        full_page=True,
    )
```

The screenshot capture is the same protocol as
`skills/for-evaluator/visual-evidence.md`. The filename
convention matches; the evaluator's merge comment references it.

Cross-stack projects (Python API + Next.js UI) run both: httpx
scenarios for API-only ACs, Playwright scenarios for UI ACs. Keep
them in separate feature files — `api-guardrails.feature` and
`ui-guardrails.feature` — so the runner can subset cleanly.

## What pytest-bdd is NOT

- **Not a replacement for pytest unit tests.** Unit tests use
  plain `def test_*`. BDD adds the user-contract layer on top.
- **Not a replacement for `behave`.** `behave` is a valid
  alternative and some projects prefer its output shape. Pick
  one per project; document in the project-level CLAUDE.md.
- **Not a replacement for Playwright for UI.** For UI
  scenarios, Playwright drives the browser; pytest-bdd is the
  orchestration layer that calls Playwright steps.

## Related

- [`fastapi-service-pattern.md`](fastapi-service-pattern.md) —
  the service under test.
- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../../for-all-roles/bdd-acceptance-scenarios.md)
  — the planner-side AC format.
- [`skills/for-evaluator/live-bdd-verification.md`](../../for-evaluator/live-bdd-verification.md)
  — the evaluator's gate that runs these scenarios live.
- [`skills/for-all-roles/playwright-user-simulation.md`](../../for-all-roles/playwright-user-simulation.md)
  — Playwright basics for the UI boundary.
