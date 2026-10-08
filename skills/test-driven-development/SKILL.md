---
name: test-driven-development
description: Apply Test-Driven Development (TDD) for a new feature, bug fixes, and behavior-changing refactors. Use when writing code that requires a test first, following the Red-Green-Refactor cycle. Do NOT use for configuration changes, documentation, or pure structural refactors.
---

# Test-Driven Development (TDD)

## Overview

**Core Principle:** If you did not watch the test fail, you do not know whether it tests the right thing.

**Rule Enforcement:** Violating the letter of the rules violates the spirit of the rules.

## Scope Check (Run This First)

**New feature, bug fix, or behavior-changing Refactor**: ALWAYS follow the full Red-Green-Refactor cycle.
**Pure structural change (behavior unchanged)**: NO new test required. ALWAYS run the full suite and confirm it stays green before calling the change done.
**Documentation or configuration change**: This skill does not apply.
**No test framework detected**: ALWAYS stop and ask the operator. NEVER proceed on assumption.
**Test command is flaky (nondeterministic pass or fail across repeated runs)**: ALWAYS stop and flag to the operator before continuing, NEVER treat any single run as ground truth.

## Waiving TDD

The operator can waive TDD, or just waive the refactor step, for one specific change. The waiver must be an explicit and direct instruction from the operator, not a rationalization you invent.

## The Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**

NEVER write code before writing the test and watching the test fail. ALWAYS implement fresh from the tests.

**No Exceptions**:
- NEVER keep code as a reference
- NEVER adapt code while your writing a test
- NEVER look at code before you have read or written its test and tested it

## Red-Green-Refactor Cycle

1. **RED**: ALWAYS write one minimal failing test that shows what should happen.
2. **Verify RED:** ALWAYS run your test command and evaluate the result:
   - If the test **fails correctly** for the expected missing feature, ALWAYS proceed to Step 3.
   - If the test **passes**, ALWAYS fix the test because it tests existing behavior.
   - If the test **errors unexpectedly**, ALWAYS fix the test setup or error and re-verify.
3. **GREEN:** ALWAYS write the simplest code that passes the test without adding unrequested features or premature engineering.
4. **Verify GREEN:** ALWAYS run your test command and evaluate the result:
   - If **all tests pass** cleanly and output is clean, ALWAYS proceed to Step 5 (or finish if refactor is waived).
   - If the new test **fails**, ALWAYS fix the production code and re-verify.
   - If **other tests fail**, ALWAYS fix the regressions immediately.
5. **REFACTOR:** ALWAYS clean up code while keeping tests green (unless explicitly waived by the operator). If you refactor, ALWAYS re-verify that tests remain green.
6. **Repeat:** ALWAYS proceed to the next feature by returning to Step 1.

### Before the First Cycle

Detect what testing framework the codebase uses and how it runs its tests (e.g., `package.json` script, `pytest`, `go test`, `cargo test`). Use that exact command in every verify step. Cannot find one? Ask the operator.

### RED - Write a Failing Test

**Required (once per task)**: ALWAYS read [writing-good-tests.md](references/writing-good-tests.md) before writing tests.

Write one minimal test that shows what should happen.

**Good Example**:
```
test('retries a failed operation 3 times')
  attempts = 0
  operation = () ->
    attempts += 1
    if attempts < 3: fail
    return 'success'

  result = retryOperation(operation)

  assert result == 'success'
  assert attempts == 3
```
The name is clear. The test checks the real behavior. It checks one thing.

**Bad Example**:
```
test('retry works')
  mock = fake that fails twice, then returns 'success'
  retryOperation(mock)
  assert mock.called 3 times
```
The name is vague. The test checks the mock, not the code.

**Requirements**:
- One behavior
- A clear name
- Real code first (no mocks unless unavoidable)

### Verify RED - Watch It Fail

**MANDATORY. NEVER skip.**

```sh
<test command> <test file>
```

Confirm:
- The test fails. It does not error.
- The failure message is the one you expect.
- The failure comes from the missing feature, not from a type.

**Test passes?** You're testing existing behavior. Fix it.
**Test errors?** Fix error, re-run until fails correctly.

### GREEN - Minimal Code

**Required (once per task)**: ALWAYS read [writing-good-code.md](references/writing-good-code.md) before writing code.

Write the simplest code that passes the test.

**Good Example**:
```
function retryOperation(operation)
  for attempt in 1..3
    try
      return operation()
    catch error
      if attempt == 3: throw error
```
This is just enough to pass.

**Bad Example**:
```
function retryOperation(operation, options = {})
  # options: maxRetries, backoff, onRetry, ...
  # YAGNI at its finest
```
This is over-engineered. The test needs none of it.

Do not add features. Do not refactor other code. Do not "improve" past the test.

### Verify GREEN - Watch It Pass

**MANDATORY. NEVER skip.**

```sh
<test command> <test file>
```

Confirm:
- The test passes.
- The other tests still pass.
- The output is clean (no errors, no warnings).

**Test fails after a green test?** The test is right and the code is wrong. Fix the code. If the assertion itself does not encapsulate the feature correctly, fix the test, then re-verify red.

**Other tests fail?** Fix now.

**"Other tests" means the codebase suite, not just your file.** A green run of the test you wrote is not a green suite. Before you call the change done, run the codebase test command even when your task named only one test file. A scope statement in your task bounds the deliverable, not your verification. Any failure that run shows, including the one you did not cause, goes in the report by name. A red test you watched scroll past and did not mention is a report falsified by omission.

### REFACTOR - Clean Up

Read [writing-good-code.md](references/writing-good-code.md) only if you have not read it for the current task.

After green only:
- Remove duplication
- Improve names
- Extract helpers

NEVER force a refactor. If code is already clean, move on.

**Keep tests green. Don't add behavior.**

**Refactor breaks a tests?** Fix it. Re-run until green.

### Repeat

After the refactor, write the next failing test for the next task.

## Common Rationalizations

- **"Too simple to test"**. Test anything with a branch, a loop, a side effect, or a boundary. A pure one-liner with none of these earns none. A test takes 30 seconds.
- **"I'll test after"**. A test written after passes at once. That proves nothing. It may test the wrong thing, test implementation instead of behavior, or miss forgotten edge cases. You never watched it fail, so you never proved it catches the bug. Test-first forces that failure.
- **"Tests after reach the same goal (spirit, not ritual)"**. Tests-after answer "what does this do?". Tests-first answer "what should this do?". A test written after is biased by code already written, verifying remembered cases rather than discovered ones. That is coverage without proof.
- **"I already tested it by hand"**. Manual testing is ad-hoc, leaves no record of coverage, and cannot be re-run automatically. Under pressure, cases are forgotten. An automated test runs the same way every time.
- **"Deleting X hours is wasteful"**. Sunk cost fallacy. That time is spent either way. The real choice is rewrite with TDD (high confidence) or keep and bolt tests on after (low confidence, likely bugs). Keeping untrusted code is the real waste.
- **"Keep it as reference, write tests first"** — You will adapt it. That is testing after. Delete means delete.
- **"I need to explore first"**. Fine. Throw away the exploration. Start with TDD.
- **"The test is hard, so the design is unclear"** — Listen to the test. Hard to test means hard to use.
- **"TDD will slow me down"**. TDD is the pragmatic path. It catches bugs before commit, stops regressions, and lets you refactor without fear. "Pragmatic" shortcuts lead to production debugging, which is slower.
- **"Manual testing is faster"**. Manual testing does not prove edge cases, and you must re-test every change manually.
- **"The existing code has no tests"**. You are improving it. Add tests for the existing code.

## Red Flags - STOP and Start Over

- Code before test
- Test after implementation
- Test passes at once
- You cannot explain why the test failed
- Tests added "later"
- You rationalize "just this once"
- "I already tested it by hand"
- "Tests after reach the same goal"
- "It is about spirit, not ritual"
- "Keep it as reference" or "adapt the existing code"
- "I already spent X hours, so deleting is wasteful"
- "TDD is dogmatic, I am being pragmatic"
- "This case is different because..."

**All of these mean: Delete your work. Start over with TDD.**

## Example: Bug Fix

**Bug:** The form accepts an empty email.

1. **RED**
```
test('rejects an empty email')
  result = submitForm({ email: '' })
  assert result.error == 'Email required'
```

2. **Verify RED**
```sh
<test command>
FAIL: expected 'Email required', got undefined
```

3. **GREEN**
```
function submitForm(data)
  if data.email is empty or blank:
    return { error: 'Email required' }
  # ...
```

4. **Verify GREEN**
```sh
<test command>
PASS
```

5. **REFACTOR**
Extract the validation if you add more fields.

## Verification Checklist

Before you mark the work complete:

- [ ] Scope check run first. Feature, bugfix, or refactor classified correctly.
- [ ] You followed the RED-GREEN-REFACTOR cycle correctly, in order for each task.
- [ ] Your tests were written using [writing-good-tests.md](references/writing-good-tests.md).
- [ ] Your code was written using [writing-good-code.md](references/writing-good-code.md).
- [ ] All tests pass.
- [ ] The output is clean. No errors and no warnings.
- [ ] The tests cover all edge cases and errors for their specific task and nothing else.

You cannot check all the boxes? You skipped TDD. Start over.

## When Stuck

**You don't know how to test?** Write the API you wish you had. Write the assertion first. Ask the operator.
**Test is too complicated?** The design is too complicated. Simplify the design interface.
**Must mock everything?** The code is too coupled. Use dependency injection.
**Test setup is huge?** Extract helpers. Still complex? Simplify the design.

## Debugging Integration

Follow the TDD cycle for every bug. The failing test proves the fix and stops the regression.

## Final Rule

**Production Code** -> a test existsand failed first
**Otherwise** -> not TDD

No exceptions without the operator's permission.
