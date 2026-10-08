---
name: verification-before-completion
description: Use before claiming that code, tests, or a build pass, are fixed, or are complete; before commits or pull requests; and before moving to another task. Requires fresh verification evidence before any success claim.
---

# Verification Before Completion

## Overview

Use this skill before you report a positive status about code or a task. Run the relevant verification command and inspect its complete output first. Evidence must support each claim.

## Required workflow

Before you make a success claim:

1. Identify the exact command that can prove the claim.
2. Run the full command in the current task. Do not rely on an earlier run.
3. Read the complete output. Check the exit code and failure count.
4. Compare the output with the claim. If the evidence does not support the claim, report the actual status.
5. Include the relevant command output as evidence with the claim.

Do not skip a step. Confidence, code changes, and another agent's report do not prove success.

## Match evidence to the claim

| Claim | Required evidence |
| --- | --- |
| Tests pass | Full test command output with zero failures |
| Linter is clean | Full lint command output with zero errors |
| Build succeeds | Full build command output and exit code zero |
| Bug is fixed | Re-run the command or test that exposed the original symptom |
| Regression test works | Confirm the test fails without the fix, then passes with the fix |
| Agent or subtask is complete | Inspect the version-control diff, then verify the changes |
| Requirements are met | Check each requirement against the result; report any gaps |

A passing linter does not prove that a build succeeds. A passing test does not prove that every requirement is met.

For regression tests, use the red-green process in `skill:test-driven-development` when applicable.

## Stop conditions

Do not make a positive claim before you collect evidence. Stop and verify if you are about to:

- say that work is done, fixed, correct, or passing;
- express satisfaction that implies success;
- commit, push, or create a pull request;
- move to another task or delegate work.

Do not use phrases such as “should work” or “looks correct” as substitutes for evidence. Do not rely on partial checks, previous command output, or reports from agents.

The operator can explicitly instruct you to skip verification. Do not grant yourself this exception.

## Report the result

State only what the evidence proves. Include the command and relevant output. If a check fails, report the failure and its observed status. If verification is incomplete, say which checks remain.
