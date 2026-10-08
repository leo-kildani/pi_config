# Writing Good Tests

## Contents

- [Usage Scope](#usage-scope)
- [Overview](#overview)
- [Principle 1: Name the Break](#principle-1-name-the-break)
- [Principle 2: Exercise the Real Thing](#principle-2-exercise-the-real-thing)
- [Tests Ship With the Implementation](#tests-ship-with-the-implementation)
- [The Mutation Check](#the-mutation-check)
- [Quick Reference](#quick-reference)
- [Warning Signs](#warning-signs)
- [Good Tests](#good-tests)

## Usage Scope

**Load this reference when:** you write or change tests, add mocks, or add cleanup or helper methods for tests.
**Do NOT load when:** you write production implementation code. For production code, read [writing-good-code.md](writing-good-code.md).

## Overview

A test exists to catch a specific break. **Two principles govern everything here:**

1. Every test names the break it catches.
2. Every test exercises the real thing.

Strict TDD produces both results. A test you write first and watch fail against real code already proves that it can fail. A test earns a mock only when the real dependency is slow or external.

## Principle 1: Name the Break

Before you write the test body, answer two questions: **Which production change breaks this test? Is that change a bug or a decision?** A test earns its place when it catches a bug. Examples include a wrong branch, a missing side effect, a boundary case, or a broken contract.

**Derive expectations independently:** Use literals and hand-checked fixtures. Table-driven tests with literal `want` values are the preferred shape. If the code under test or a helper computes the expected value, the assertion always passes:

```typescript
// WRONG: Mirror assertion: the same builder computes both sides, so the result is always true
const expected = buildSearchQuery({ tag: 'urgent' });
expect(buildSearchQuery({ tag: 'urgent' })).toBe(expected);

// RIGHT: Hand-derived literal
expect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:"urgent"');

```

**No change detectors:** If only intentional decisions can fail a test, the test is a change detector. Examples: a constant's value, exact message wording, or private structure. Such a test fires on a redesign. It sleeps through bugs. Test the behavior that depends on the decision. Do not write `expect(MAX_RETRIES).toBe(5)`. Instead, assert that the code retries a failing call 5 times and never makes a 6th attempt.

**Behavior, not text:** A check that a script, skill, or config contains an exact line proves only that the source holds that line. Run scripts against controlled inputs. Assert outputs, side effects, or exit codes. Test a document that instructs agents through the consuming agent's behavior (`superpowers:writing-skills`). Prose for humans earns no test at all.

**Your code, not the framework:** Test the contract your code makes at its boundaries. These are the route you register, the query you emit, and the payload you produce. The maintainers of upstream code write tests for those mechanics. One classic example: a test that your router invokes a registered handler tests the framework, not your code. When upstream behavior genuinely surprises you, write one narrow characterization test that names the assumption. The same boundary applies inside your code. Constructors, getters, constants, and trivial forwarding earn a test only when they validate, normalize, default, derive, enforce, or cause a side effect. Otherwise, assert the first consumer-visible result that depends on them.

### Gate Function

Before you write the test body:

- [ ] Name the production change that breaks this test.
  - Cannot name one: redesign around an observable behavior.
  - The source text changed: run the artifact and assert its effects.
  - Only intentional decisions: this is a change detector. Test the behavior that depends on the decision.
- [ ] Confirm the expected value is derived without the code under test.
  - If it reuses the code's logic or helpers, replace it with a literal or hand-checked fixture.

## Principle 2: Exercise the Real Thing

**The mock earns no assertions:** A mock assertion passes when the mock is present. It fails when the mock is absent. It says nothing about the component. Assert the real component's behavior. If you check the mock, unmock it or delete the assertion.

```typescript
// RIGHT: Real behavior
expect(screen.getByRole('navigation')).toBeInTheDocument();

// WRONG: Mock existence
expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();

```

*The operator's correction:* "Are we testing the behavior of a mock?"

**Mock at the right level:** Learn every side effect of the real method before you replace it. Mock the slow or external operation. Keep the parts the test depends on real. If you are unsure, run the test against the real implementation first. Observe what the test needs.

```typescript
// WRONG: The mock swallows the config write that duplicate detection reads
vi.mock('ToolCatalog', () => ({
  discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
}));

// RIGHT: Mock only the slow server startup; the config write stays real
vi.mock('MCPServerManager');

```

**Make doubles specific:** When arguments, call counts, or ordering are part of the contract, assert them. A fake that accepts anything verifies nothing. Give each branch (success, error, malformed) its own fixture or spy. Then the wrong branch cannot satisfy the expectation.

**Mirror real data completely:** Mock the complete structure as it exists in reality. Include all documented fields, not just the ones your test reads. Partial mocks fail silently when downstream code reads an omitted field. The test passes while integration breaks.

**Production classes carry production methods only:** Cleanup that only tests need lives in test utilities, never as a `destroy()` on the production class. Ask: do only tests call this method? Does this class own this resource's lifecycle? If either answer is wrong, use a test utility.

**Prefer real components over complex mocks:** Mock setup can outgrow the test logic. Mocks can miss methods that the real components have. Tests can break when the mock changes. In all three cases, switch to an integration test with real components.

*The operator's question:* "Do we need to be using a mock here?"

### Gate Function

Before you add a mock or test helper:

- [ ] List the real method's side effects. Keep the ones the test depends on real. Mock the slow or external level below them.
- [ ] Mirror the complete real structure in every mock response.
- [ ] Keep a method that only tests call in test utilities, never in production.
- [ ] Do not assert on the mock itself. Unmock it or delete the assertion.

## Tests Ship With the Implementation

The TDD cycle (i.e., failing test, minimal implementation, refactor) defines what "complete" means. Ship the tests the behavior needs, and no more. Trivial code and human prose earn none. A test written only to satisfy process costs maintenance forever.

## The Mutation Check

Before you finish, mentally mutate the production code. At least one test must fail for each realistic mutation:

- Wrong constant or argument
- Wrong branch handler
- Missing state change or side effect
- Empty or default return
- Missing validation for zero, empty, nil, unauthorized, or malformed input

A mutation nothing catches marks the behavior as unprotected or the test as tautological.

## Quick Reference

| When you... | Do |
| --- | --- |
| Write any test | Name the break it catches: a bug, not a decision |
| Build an expected value | Derive it by hand. Do not use the code under test |
| Test a script or document | Run it or pressure-test its consumer. Do not grep its text |
| Reach for a dependency test | Test your boundary contract, not their documented mechanics |
| Want to assert on a mocked element | Test the real component, or unmock it |
| Are about to mock a method | Learn its side effects. Mock the slow or external level |
| Build a mock response | Mirror the real structure completely |
| Need cleanup only tests use | Put cleanup that only tests use in test utilities |
| Watch mock setup balloon | Switch to an integration test with real components |
| Finish a test file | Run the mutation check |

## Warning Signs

- Setup and assertion share the same object, so equality is guaranteed
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

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in the name? Split the test. | `test('validates email and domain and whitespace')` |
| **Clear** | The name describes the behavior. | `test('test1')` |
| **Shows intent** | The test demonstrates the desired API. | The test hides the intended behavior. |

**Keep tests honest**:

- Name the production change that breaks the test. Do this before you write the test.
- Assert on real behavior. Never assert on mock behavior.
- Keep test-only code in test utilities. Keep it out of production classes.
- Understand a dependency's side effects before you mock it.
