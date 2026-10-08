---
name: test-driven-development
description: Apply Test-Driven Development (TDD) for a new feature, bug fixes, and behavior-changing refactors. Use when writing code that requires a test first, following the Red-Green-Refactor cycle. Do NOT use for configuration changes, documentation, or pure structural refactors.
---

# Test-Driven Development (TDD)

## Overview

**Core Principle:** If you do not watch the test fail, you do not know whether the test checks the right behavior.

**Rule Enforcement:** If you break the letter of the rules, you break the spirit of the rules.

## Scope Check (Run This First)

**New feature, bug fix, or behavior-changing Refactor**: ALWAYS follow the full Red-Green-Refactor cycle.
**Pure structural change (behavior unchanged)**: NO new test required. ALWAYS run the full suite. Confirm the suite stays green before you call the change done.
**Documentation or configuration change**: This skill does not apply.
**No test framework detected**: ALWAYS stop and ask the operator. NEVER proceed on assumption.
**Test command is flaky (nondeterministic pass or fail across repeated runs)**: ALWAYS stop and flag the flaky command to the operator. NEVER treat a single run as ground truth.

## Waiving TDD

The operator can waive TDD for one specific change. The operator can also waive only the refactor step. The waiver must be an explicit and direct instruction from the operator, not a rationalization you invent.

## The Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**

Write the test first. Watch the test fail. Then write the code.

**No Exceptions**:
- NEVER keep code as a reference
- NEVER adapt code while you write a test
- NEVER look at code before you read or write its test
- NEVER look at code before you run its test

## Red-Green-Refactor Cycle

1. **RED**: ALWAYS write one minimal failing test that shows what should happen.
2. **Verify RED:** ALWAYS run your test command. Then evaluate the result:
   - If the test **fails correctly** for the expected missing feature, ALWAYS proceed to Step 3.
   - If the test **passes**, ALWAYS fix the test because it tests existing behavior.
   - If the test **errors unexpectedly**, ALWAYS fix the test setup or error. Then re-run the test.
3. **GREEN:** ALWAYS write the simplest code that passes the test. Do not add unrequested features or premature engineering.
4. **Verify GREEN:** ALWAYS run your test command and evaluate the result:
   - If **all tests pass**  and the output is clean, ALWAYS proceed to Step 5. If the operator waives the refactor step, finish here.
   - If the new test **fails**, ALWAYS fix the production code. Then re-run the test.
   - If **other tests fail**, ALWAYS fix the regressions immediately.
5. **REFACTOR:** ALWAYS clean up the code and keep the tests green. An explicit operator waiver is the only exception. If you refactor, ALWAYS run the test again.
6. **Repeat:** ALWAYS return to Step 1 for the next task.

### Before the First Cycle

Find the testing framework that the codebase uses. Find the exact command that runs its test (e.g., `package.json` script, `pytest`, `go test`, `cargo test`). Use that exact command in every verify step. If you cannot find one, ask the operator.

### RED - Write a Failing Test

**Required (once per task)**: ALWAYS read [writing-good-tests.md](references/writing-good-tests.md) before you write tests.

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

**If the test passes,** you test existing behavior. Fix the test.
**If the test errors,** fix the error. Re-run the test until it fails in the correct way.

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

**If the test fails after a green test,** the test is right and the code is wrong. Fix the code. If the assertion does not capture the feature correctly, fix the test. Then verify red again.

**If other tests fail,** fix them now following the TDD cycle.

**"Other tests" means the codebase suite, not just your file.** A green run of the test you wrote is not a green suite. Before you call the change done, run the codebase test command. Run it even when your task names only one test file. A scope statement in your task bounds the deliverable, not your verification. Any failure that run shows, including the one you did not cause, goes in the report by name. If you watch a test fail and do not mention it, your report is incomplete. 

### REFACTOR - Clean Up

Read [writing-good-code.md](references/writing-good-code.md) only if you have not read it for the current task.

After green only:
- Remove duplication
- Improve names
- Extract helpers

NEVER force a refactor. If code is already clean, move on.

**Keep tests green. Don't add behavior.**

**If the refactor breaks a test,** Fix it. Re-run the tests until they pass.

### Repeat

After the refactor, write the next failing test for the next task.

## Common Rationalizations

- **"Too simple to test"**. Test anything with a branch, a loop, a side effect, or a boundary. A pure one-liner with none of these earns none. A test takes 30 seconds.
- **"I'll test after"**. A test written after passes at once. That proves nothing. It may test the wrong thing, test implementation instead of behavior, or miss forgotten edge cases. You never watched it fail. Therefore you never proved that it catches the bug. 
- **"Tests after reach the same goal (spirit, not ritual)"**. Tests-after answer "what does this do?". Tests-first answer "what should this do?". Code that already exists biases the test you write after. That test verifies remembered cases, not discovered ones. That is coverage without proof.
- **"I already tested it by hand"**. Manual testing is ad-hoc. It leaves no record of coverage. You cannot re-run it automatically. Under pressure, you forget cases. An automated test runs the same way every time.
- **"Deleting X hours is wasteful"**. Sunk cost fallacy. That time is spent either way. The real choice is a rewrite with TDD, which gives high confidence. The other choice keeps the code and adds tests later, which gives low confidence and likely bugs. Keeping untrusted code is the real waste.
- **"Keep it as reference, write tests first"** — You adapt it. That is testing after. Delete means delete.
- **"I need to explore first"**. Fine. Throw away the exploration. Start with TDD.
- **"The test is hard, so the design is unclear"** — Listen to the test. Hard to test means hard to use.
- **"TDD will slow me down"**. TDD is the pragmatic path. It catches bugs before commit. It stops regression. It lets you refactor without fear. "Pragmatic" shortcuts lead to production debugging, which is slower.
- **"Manual testing is faster"**. Manual testing does not prove edge cases. You must re-test every change manually.
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

- [ ] You ran the scope check first.
- [ ] You classified the change as a feature, bugfix, or a refactor.
- [ ] You followed the RED-GREEN-REFACTOR cycle correctly, in order for each task.
- [ ] You wrote your tests with [writing-good-tests.md](references/writing-good-tests.md).
- [ ] You wrote your code with [writing-good-code.md](references/writing-good-code.md).
- [ ] All tests pass.
- [ ] The output is clean. No errors and no warnings.
- [ ] The tests cover all edge cases and errors for their task only.

If you cannot check all the boxes, you skipped TDD. Start over.

## When Stuck

**If you do not know how to test,** write the API you wish you had. Write the assertion first. Then ask the operator.
**If the test is too complicated,** the design is too complicated. Simplify the design interface.
**If you must mock everything,** the code is too coupled. Use dependency injection.
**If the test setup is huge,** extract helpers. If the design is still complex, simplify it.

## Debugging Integration

Follow the TDD cycle for every bug. The failing test proves the fix. It also stops the regression.

## Final Rule

**Production Code** -> a test exists and failed first
**Otherwise** -> not TDD

No exceptions without the operator's permission.
