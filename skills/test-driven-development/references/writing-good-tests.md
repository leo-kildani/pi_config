# Writing Good Tests

## Usage Scope

**Load this reference when:** writing or changing tests, adding mocks, or adding cleanup/helper methods for tests.
**Do NOT load when:** writing production implementation code. For production code, read [writing-good-code.md](writing-good-code.md).

## Overview

A test exists to catch a specific break. **Two principles govern everything here:**

1. Every test names the break it catches.
2. Every test exercises the real thing.

Strict TDD produces both naturally: a test written first and watched failing against real code has already proven it can fail, and only earns a mock when the real dependency proves slow or external.

## Principle 1: Name the Break

Before writing the test body, ALWAYS answer: **what production change should make this test fail, and is that change a bug or a decision?** A test earns its place by catching a wrong branch, missing side effect, wrong argument, boundary case, or broken contract.

**Derive expectations independently:** Use literals and hand-checked fixtures; table-driven tests with literal `want` values are the preferred shape. An expectation computed by the code under test or its helpers passes no matter what that code does:

```typescript
// WRONG: Mirror assertion: the same builder computes both sides, so the result is always true
const expected = buildSearchQuery({ tag: 'urgent' });
expect(buildSearchQuery({ tag: 'urgent' })).toBe(expected);

// RIGHT: Hand-derived literal
expect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:"urgent"');

```

**No change detectors:** If only intentional decisions can fail a test, such as a constant's value, exact message wording, or private structure, it fires on redesign and sleeps through bugs. Test the behavior that depends on the decision: not `expect(MAX_RETRIES).toBe(5)` but "a failing call is retried 5 times and the 6th attempt never happens."

**Behavior, not text:** Asserting that a script, skill, or config contains an exact line proves only that the source is the source. Run scripts against controlled inputs and assert outputs, side effects, or exit codes. Documents that instruct agents are tested by the consuming agent's behavior (`superpowers:writing-skills`); prose for humans earns no test at all.

**Your code, not the framework:** Test the contract your code makes at its boundaries: the route you register, the query you emit, and the payload you produce. Upstream mechanics are their maintainers' tests to write (the classic: asserting your router invokes a registered handler; that is the framework's test, not yours). When upstream behavior genuinely surprised you, write one narrow characterization test naming the assumption. The same boundary applies inside your code: constructors, getters, constants, and trivial forwarding earn tests only when they validate, normalize, default, derive, enforce, or cause side effects. Otherwise, assert the first consumer-visible result that depends on them.

### Gate Function

```
BEFORE writing the test body:
  ALWAYS name the production change that would make this test fail.

  - Cannot name one         → redesign around an observable behavior
  - "The source text changed" → run the artifact and assert its effects
  - Only intentional decisions → change detector; test the behavior
                                 that depends on the decision

  ALWAYS confirm the expected value is derived without the code under test.
  - IF it reuses the code's logic or helpers:
    Replace it with a literal or hand-checked fixture

```

## Principle 2: Exercise the Real Thing

**The mock earns no assertions:** A mock assertion passes when the mock is present and fails when it is absent. It says nothing about the component. ALWAYS assert the real component's behavior; if the mock is what you are checking, unmock it or delete the assertion.

```typescript
// RIGHT: Real behavior
expect(screen.getByRole('navigation')).toBeInTheDocument();

// WRONG: Mock existence
expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();

```

*Your human partner's correction:* "Are we testing the behavior of a mock?"

**Mock at the right level:** Learn every side effect of the real method before replacing it; mock the slow or external operation and keep what the test depends on real. When unsure, run the test against the real implementation first and observe what actually needs to happen.

```typescript
// WRONG: The mock swallows the config write that duplicate detection reads
vi.mock('ToolCatalog', () => ({
  discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
}));

// RIGHT: Mock only the slow server startup; the config write stays real
vi.mock('MCPServerManager');

```

**Make doubles specific:** When arguments, call counts, or ordering are part of the contract, ALWAYS assert them. A fake that accepts anything verifies nothing. Give each branch (success, error, malformed) its own fixture or spy, so the wrong branch cannot satisfy the expectation.

**Mirror real data completely:** Mock the complete structure as it exists in reality, including all documented fields, not just the ones your test reads. Partial mocks fail silently when downstream code reads an omitted field: the test passes while integration breaks.

**Production classes carry production methods only:** Cleanup that only tests need lives in test utilities, never as a `destroy()` on the production class. Ask: is this method called only from tests? Does this class own this resource's lifecycle? Wrong answers → test utility.

**Prefer real components over complex mocks:** When mock setup outgrows the test logic, mocks miss methods the real components have, or tests break when the mock changes, switch to an integration test with real components.

*Your human partner's question:* "Do we need to be using a mock here?"

### Gate Function

```
BEFORE adding a mock or test helper:
  - List the real method's side effects; keep the ones the test
    depends on real. Mock the slow or external level below them.
  - Mock responses must mirror the complete real structure.
  - A method only tests call lives in test utilities, never production.
  - About to assert on the mock itself? Unmock it or delete the assertion.

```

## Tests Ship With the Implementation

The TDD cycle (i.e., failing test, minimal implementation, refactor) defines what "complete" means. Ship the tests the behavior needs and only those: trivial code and human prose earn none, and a test written to satisfy process costs maintenance forever.

## The Mutation Check

Before finishing, ALWAYS mentally mutate the production code. At least one test should fail for each realistic mutation:

- Wrong constant or argument
- Wrong branch handler
- Missing state change or side effect
- Empty or default return
- Missing validation for zero, empty, nil, unauthorized, or malformed input

A mutation nothing catches marks the behavior as unprotected or the test as tautological.

## Quick Reference

| When you... | Do |
| --- | --- |
| Write any test | ALWAYS name the break it catches: a bug, not a decision |
| Build an expected value | ALWAYS derive it by hand; never with the code under test |
| Test a script or document | ALWAYS run it / pressure-test its consumer; never grep its text |
| Reach for a dependency test | ALWAYS test your boundary contract, not their documented mechanics |
| Want to assert on a mocked element | ALWAYS test the real component, or unmock it |
| Are about to mock a method | ALWAYS learn its side effects; mock the slow/external level |
| Build a mock response | ALWAYS mirror the real structure completely |
| Need cleanup only tests use | ALWAYS put it in test utilities |
| Watch mock setup balloon | ALWAYS switch to an integration test with real components |
| Finish a test file | ALWAYS run the mutation check |

## Warning Signs

- Setup and assertion share the same object, guaranteeing equality
- The test can fail only through a panic, crash, or missing selector
- The test fails on every intentional change, never on accidental breakage
- Expected values are hidden behind loops, builders, or helpers
- The test greps source text, or asserts a removed symbol stays removed
- The test would still matter if only the framework remained
- The test exists for coverage, checking no side effect or outcome
- An assertion checks a `*-mock` test ID, or fails if you remove the mock
- A method is called only from test files
- Mock setup is more than half the test, or you can't explain why the mock is needed
- Mocking "just to be safe"

## Test Quality

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in the name? Split the test. | `test('validates email and domain and whitespace')` |
| **Clear** | The name describes the behavior. | `test('test1')` |
| **Shows intent** | The test demonstrates the desired API. | The test hides what the code should do. |

**Keep tests honest**:
- Name the production change that would make the test fail. Do this before you write the test.
- Assert on real behavior. Never assert on mock behavior.
- Keep test-only code in test utilities. Keep it out of production classes.
- Understand a dependency's side effects before you mock it.
