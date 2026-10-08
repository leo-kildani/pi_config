---
name: testing-agent-skills
description: Use when evaluating whether an agent skill changes agent behavior, checking skill compliance under pressure, or diagnosing why a skill is ignored or misapplied.
---

# Testing Agent Skills

**REQUIRED BACKGROUND:** Read and apply `skill:test-driven-development`. It defines the RED-GREEN-REFACTOR cycle used here.

## Overview

Evaluate skills with a documentation-focused TDD cycle. Define realistic pressure scenarios. Observe behavior without the skill. Then compare behavior with the skill in context. A skill has value only when an agent can find and apply its guidance in the situations it targets.

## When to use

Use this process when a skill is new or changed, when an agent ignores or misapplies its instructions, or when you need evidence that a skill handles realistic cases.

Do not treat a text review as a behavior test. Reading a skill can find unclear wording, but it cannot show how an agent acts under pressure.

## Test cycle

### RED: Define and run the baseline

1. Identify the behavior the skill is intended to change. Express success as observable actions or output, not as "follows the skill."
2. Create realistic scenarios before you evaluate the skill. Include the pressures and context that commonly cause the target failure.
3. Use an agent context where the skill is not available. Do not expose the skill's contents or paraphrase its rules in the prompt.
4. Run each scenario. Record the agent's exact relevant behavior. Include rationalizations, omissions, and any successful behavior.
5. Confirm the baseline reveals the specific gap the skill is meant to address. If the agent already meets the criteria, the scenario does not demonstrate a need. Revise the scenario, or report that the baseline did not fail.

Use a separate agent or subagent for the scenario when available. Keep the evaluator's coaching out of the tested context. If isolation is unavailable, state that limitation and avoid presenting the result as an independent baseline.

### GREEN: Check behavior with the skill

1. Make the same skill available to a fresh agent context. Keep the scenario and success criteria unchanged.
2. Run the same prompt and compare observable behavior with the baseline.
3. Mark each criterion as met or unmet. A pass requires the agent to perform the required behavior, not merely quote or acknowledge the instruction.
4. If the behavior does not improve, identify where the instruction failed to guide action. Do not count an explanation of the rule as compliance.

### REFACTOR: Close observed gaps

1. Use the recorded failure, not a hypothetical concern, to identify the gap.
2. Change the skill to address that gap without weakening behavior that already passed.
3. Re-run the failed scenario and the relevant passing scenarios with a fresh context.
4. Repeat until the target behavior holds across the scenarios, or report the remaining failures and limitations.

Do not change the scenario, criteria, or skill during a run. Change them between runs and record the change so the comparison remains meaningful.

## Scenario design

Choose the scenario type that matches the skill's intended behavior:

| Skill behavior | Scenario focus | Passing evidence |
|---|---|---|
| Discipline or hard constraints | Apply realistic pressure to skip or violate the rule. Combine pressures when relevant | Agent follows the constraint and does not use a rationale to bypass it |
| Technique | Apply the method to a new, representative case. Include a relevant variation | Agent applies the method correctly and adapts to the case |
| Decision pattern | Include cases where the pattern applies and counterexamples where it does not | Agent identifies when to apply the pattern and when not to |
| Reference | Ask the agent to retrieve and apply information from the reference | Agent locates the relevant guidance and applies it correctly |

Vary phrasing and context to check that the skill handles intent rather than a memorized prompt. Include nearby non-applicable cases when false activation or over-application could cause harm.

## Pressure and rationalization checks

For skills that enforce discipline, test realistic conflicts. Examples are urgency, sunk cost, fatigue, operator pressure, or a claim that the current case is an exception. Combine pressures when the skill must withstand more than one at a time.

Record the agent's own reasoning that precedes a violation. Treat statements such as "just this once," "I can do it afterward," or "the intent is still met" as evidence of a loophole when they lead to non-compliance. Verify that a revised skill prevents the behavior, not just that the agent can recite a stronger rule.

For output-shape failures, assess whether required elements appear in the required order. For omission failures, check whether every required element is present. Do not use a pressure test to measure a problem it does not represent.

## Results record

Keep a compact record for each evaluation:

```text
Scenario:
Skill version or revision:
Context: skill absent / skill present
Success criteria:
Observed behavior:
Result: pass / fail
Notes:
```

Report baseline and with-skill results separately. State which scenarios passed, which failed, and any isolation or runtime limitations. Do not claim a skill is effective based only on its wording or on an agent's self-assessment.

## Final check

- [ ] Scenarios represent the skill's intended behavior.
- [ ] Baseline runs occurred without the skill or its instructions in context.
- [ ] Success criteria are observable and unchanged between baseline and with-skill runs.
- [ ] With-skill runs used a fresh context with the skill available.
- [ ] Results distinguish compliance from merely restating instructions.
- [ ] Observed failures informed revisions.
- [ ] You re-ran the relevant scenarios.
- [ ] Report remaining failures and test limitations clearly.
