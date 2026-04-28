---
name: godog-bdd-pattern
description: Use when writing or reviewing BDD scenarios for a Go service. Maps planner's Given/When/Then issue AC to godog feature files + step definitions, using net/http (or resty) + testcontainers-go as the boundary drivers. Same .feature files that pytest-bdd or Playwright consume elsewhere; the step implementation language changes, the contract does not.
---

# Skill — godog BDD pattern for Go services

**For**: generator (authors) + evaluator (re-runs live).
**Applies when**: Go stack is enabled and the issue's AC is
Given/When/Then (per
`skills/for-all-roles/bdd-acceptance-scenarios.md`).

## Why godog

godog is a Cucumber-compatible test runner for Go. It reads
the same `.feature` syntax that pytest-bdd or Cucumber.js
reads — so an issue's AC scenarios copy-paste into the Go
project's feature file with zero translation.

## Install

```bash
go get github.com/cucumber/godog@v0.15.0
go get github.com/stretchr/testify@v1.10.0
go mod tidy
```

Add to `.go-version`'s corresponding `go.mod`:

```
require (
    github.com/cucumber/godog v0.15.0
    github.com/stretchr/testify v1.10.0
)
```

## Directory layout

```
tests/
  bdd/
    features/
      guardrails.feature       # 1 file per issue / feature cluster
    steps/
      main_test.go             # TestMain, scenario bootstrap
      guardrail_steps.go       # step definitions
```

## The .feature file = the issue AC

Verbatim copy from the planner's issue:

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

## Step file

```go
// tests/bdd/steps/main_test.go
package bdd

import (
    "os"
    "testing"

    "github.com/cucumber/godog"
    "github.com/cucumber/godog/colors"
)

func TestFeatures(t *testing.T) {
    suite := godog.TestSuite{
        ScenarioInitializer: InitializeScenario,
        Options: &godog.Options{
            Format:   "pretty,junit:../../../tests/e2e/test-results/local/latest/godog.xml",
            Paths:    []string{"../features"},
            Output:   colors.Colored(os.Stdout),
            TestingT: t,
        },
    }
    if suite.Run() != 0 {
        t.Fatal("non-zero status from godog")
    }
}

// tests/bdd/steps/guardrail_steps.go
package bdd

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"

    "github.com/cucumber/godog"
)

type scenarioCtx struct {
    token    string
    tenant   string
    resp     *http.Response
    body     []byte
    chatResp *http.Response
    chatBody []byte
    baseURL  string
}

func InitializeScenario(s *godog.ScenarioContext) {
    sc := &scenarioCtx{baseURL: "http://api:8000"}

    s.Before(func(ctx context.Context, sc2 *godog.Scenario) (context.Context, error) {
        *sc = scenarioCtx{baseURL: "http://api:8000"}
        return ctx, nil
    })

    s.Step(`^an admin bearer token for tenant "([^"]+)"$`, sc.anAdminToken)
    s.Step(`^no "([^"]+)" guardrail exists for tenant "([^"]+)"$`, sc.noGuardrail)
    s.Step(`^the admin POSTs to "([^"]+)" with name "([^"]+)" severity "([^"]*)"$`, sc.postGuardrail)
    s.Step(`^the response status is (\d+)$`, sc.responseStatus)
    s.Step(`^a subsequent POST to "([^"]+)" containing profanity returns (\d+)$`, sc.chatBlocked)
    s.Step(`^the rejection reason is "([^"]+)"$`, sc.rejectionReason)
    s.Step(`^the error field for "([^"]+)" says "([^"]+)"$`, sc.errorField)
}

func (sc *scenarioCtx) anAdminToken(tenant string) error {
    sc.token = "Bearer test-admin-" + tenant
    sc.tenant = tenant
    return nil
}

func (sc *scenarioCtx) noGuardrail(name, tenant string) error {
    req, _ := http.NewRequest("DELETE", sc.baseURL+"/guardrails/"+name, nil)
    req.Header.Set("Authorization", sc.token)
    _, err := http.DefaultClient.Do(req)
    return err
}

func (sc *scenarioCtx) postGuardrail(path, name, severity string) error {
    payload := map[string]string{"name": name}
    if severity != "" {
        payload["severity"] = severity
    }
    body, _ := json.Marshal(payload)
    req, _ := http.NewRequest("POST", sc.baseURL+path, bytes.NewReader(body))
    req.Header.Set("Authorization", sc.token)
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    sc.resp = resp
    sc.body, _ = io.ReadAll(resp.Body)
    return nil
}

func (sc *scenarioCtx) responseStatus(want int) error {
    if sc.resp.StatusCode != want {
        return fmt.Errorf("want status %d, got %d: %s", want, sc.resp.StatusCode, sc.body)
    }
    return nil
}

func (sc *scenarioCtx) chatBlocked(path string, want int) error {
    payload := []byte(`{"message": "damn profanity here"}`)
    req, _ := http.NewRequest("POST", sc.baseURL+path, bytes.NewReader(payload))
    req.Header.Set("Authorization", sc.token)
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    sc.chatResp = resp
    sc.chatBody, _ = io.ReadAll(resp.Body)
    if resp.StatusCode != want {
        return fmt.Errorf("want chat status %d, got %d: %s", want, resp.StatusCode, sc.chatBody)
    }
    return nil
}

func (sc *scenarioCtx) rejectionReason(want string) error {
    var out struct {
        Reason string `json:"reason"`
    }
    if err := json.Unmarshal(sc.chatBody, &out); err != nil {
        return err
    }
    if out.Reason != want {
        return fmt.Errorf("want reason %q, got %q", want, out.Reason)
    }
    return nil
}

func (sc *scenarioCtx) errorField(field, msg string) error {
    var out struct {
        Errors map[string]string `json:"errors"`
    }
    if err := json.Unmarshal(sc.body, &out); err != nil {
        return err
    }
    got := out.Errors[field]
    if got != msg {
        return fmt.Errorf("want error[%s]=%q, got %q", field, msg, got)
    }
    return nil
}
```

Rules:

- **One `scenarioCtx` per scenario.** godog's `Before` hook
  resets the struct so scenarios don't leak state.
- **No assertions in Given/When steps.** Given seeds state;
  When performs the action; Then asserts. godog returns the
  error to mark the step failed.
- **No `testing.T` in step functions.** godog passes errors
  via return; `t.Fatal` inside would bypass godog's reporter.
- **No shared package-level mutable state.** Each scenario
  starts clean; the ctx is the only allowed carry.

## Running against live compose

```bash
# 1. Stack up.
docker compose up -d --build

# 2. Wait for healthy.
./scripts/wait-for-healthy.sh

# 3. Run godog — client points at the compose-network hostname.
go test -v ./tests/bdd/steps/... \
  -godog.format=pretty,junit:tests/e2e/test-results/local/latest/godog.xml

# Or from a sidecar test container:
docker compose run --rm test-runner go test -v ./tests/bdd/steps/...
```

## UI + backend coordination

When the project has both a Go backend and a frontend (Next.js,
HTMX, whatever), scenarios split cleanly:

- `tests/bdd/features/api-*.feature` → godog driving `net/http`
- `tests/e2e/specs/ui-*.spec.ts` → Playwright driving the browser

Planner decides per scenario which surface it exercises; the
generator authors the spec against the appropriate surface. The
evaluator runs both suites live against the running compose
stack.

## What godog is NOT

- **Not a replacement for `go test`.** Unit tests live in
  `*_test.go` alongside the code they test. godog adds the
  user-contract layer on top.
- **Not a replacement for Playwright.** For UI scenarios,
  Playwright is the boundary driver. godog for API-only.
- **Not a mock harness.** Steps make real HTTP calls against
  a running service. If the test needs mocking, it belongs as
  a unit test, not a BDD scenario.

## Related

- [`gin-service-pattern.md`](gin-service-pattern.md) — the
  service under test.
- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../../for-all-roles/bdd-acceptance-scenarios.md)
  — planner-side AC format.
- [`skills/for-evaluator/live-bdd-verification.md`](../../for-evaluator/live-bdd-verification.md)
  — evaluator's gate that runs these scenarios live.
- [`skills/stacks/python/pytest-bdd-pattern.md`](../python/pytest-bdd-pattern.md)
  — Python-side counterpart; feature files are interchangeable.
