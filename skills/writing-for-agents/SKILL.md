---
name: writing-for-agents
description: Writes documents that agents consume, such as skills, AGENTS.md files, CLAUDE.md files, and linked documents. Use when creating, editing, or reviewing any agent-facing document.
---

# Writing for Agents

**REQUIRED BACKGROUND:** Read and apply `skill:writing-in-ste`. It defines the writing style for every agent-facing document.

## Overview

This skill is a reference for any document that an agent consumes. Examples are a skill, an `AGENTS.md` or `CLAUDE.md` file, and a document that a pointer reaches. The package differs. The writing does not. The same levers make each document predictable. The agent follows the same process on every run. It does not produce the same output.

When you write a skill, read [references/skill-mechanics.md](references/skill-mechanics.md). It covers frontmatter, invocation, and router skills.

When you write an `AGENTS.md` file, read [references/agentsmd-mechanics.md](references/agentsmd-mechanics.md). It covers the repository inventory, the file structure, monorepos, and the template.

## Context pointers

A context pointer is a reference in the agent context. It names material outside the context. It also states the condition to reach that material. A skill description is a context pointer. A line in `AGENTS.md` that names a document is the same object.

The wording of the pointer decides when the agent reaches the material and how reliably. The target does not decide this. A must-have target behind a weak pointer is a variance bug. Sharpen the wording first. Inline the material only if sharpening fails.

A pointer does two jobs. It states what the material is. It also lists the branches that trigger a reach. A branch is a distinct case that the document handles. Different runs take different paths through the branches.

Every word of an always-loaded pointer costs on every turn. Thus the pointer needs stricter pruning than the body.

- Put the leading word first. The pointer does its trigger work there.
- Use one trigger per branch. Synonyms that rename one branch repeat that branch. Collapse them. Keep only distinct branches.
- Remove identity that the body already carries.

## The two loads

Every document and every pointer spends one of two budgets.

- Context load is the cost of always-loaded material on the agent window. Examples are an `AGENTS.md` line, a skill description, and any text in context on every turn. It spends tokens and attention whether it fires or not.
- Cognitive load is the cost on the human. The human must know which documents exist. The human must also know when to reach for each one. The human is the index. Do not minimise this load. It is the price of human agency. Spend it where human judgement matters. Remove it where human judgement does not matter.

Material that a pointer reaches escapes context load. It pays only for the pointer line. Material with no pointer rides entirely on cognitive load.

## Information hierarchy

A document contains two content types. Steps are the ordered actions that the agent performs. Reference is the definitions, rules, and facts that the agent consults on demand. The two types mix freely. A recipe is all steps. A review rule set or this skill is all reference. Both types can also occur together.

The core decision is the position of each piece on the information hierarchy. The ladder ranks material by how soon the agent needs it.

1. In-file step is the primary tier. It is what the agent does, in order.
2. The agent consults in-file reference on demand. It is often a flat peer set, such as every rule of a review on one rung. This arrangement is correct, not a defect.
3. You push disclosed reference into a separate file. A context pointer reaches it. The agent loads it only when the pointer fires. It ranges from a sibling file in the same folder to an external reference anywhere. Any document can point at it.

If you push too little down, the top becomes bloated. If you push too much down, you hide material that the agent needs. That tension is the whole decision.

Progressive disclosure is the move down the ladder. Move material out of the main file and behind a pointer. Thus the top stays legible. It is not mainly a token optimisation. It protects the hierarchy. Branching is the cleanest disclosure test. Inline what every branch needs. Push behind a pointer what only some branches reach. If a document has steps, in-file reference that belongs behind a pointer buries the steps. The agent then attends to the steps by chance. This is a variance lever, not only a legibility problem.

Co-location is the companion rule within a file. The ladder decides how far down a piece sits. Co-location decides what sits beside it. Keep the definition, rules, and caveats of one concept under one heading. Do not scatter them. Thus a reader of one part meets its neighbours. The test is simple. The document must read like documentation for the agent. Grouped material reads that way. Scattered material does not. Co-location differs from duplication. Duplication repeats one meaning in two places. A scattered arrangement fragments one meaning across many places.

Sprawl is the failure mode here. A document is too long even when every line is live and unique. Attention thins across the excess. Every extra line is one more line to keep relevant. The cure is the ladder. Disclose reference behind pointers. Split by branch or sequence. Thus each path carries only what it needs.

## Steps and completion criteria

Every step ends on a completion criterion. This criterion states the condition that tells the agent that the work is done. Two properties make it a lever.

- Clarity: can the agent tell done from not-done? A vague bound ("understanding reached") invites premature completion. The agent ends the step before it is genuinely done. Its attention slips to being done. The visible steps ahead (the post-completion steps) supply the pull. The clarity of the criterion supplies the resistance. Defend in this order. Sharpen the bound first. This action is local and cheap. The bound can be irreducibly fuzzy. Hide the later steps by splitting the sequence only if you also observe the rush. Hiding works only across a real context boundary, such as a hand-off or a subagent dispatch. An inline call leaves the later steps in context and clears nothing.
- Demand: how much the step requires. "Every modified model accounted for" forces thorough work. "Produce a change list" does not. Demand drives legwork. Legwork is the digging that the agent does within the work. It is latent in the wording. You do not write it as its own step. Demand is not step-bound. "Every rule applied" binds a body of flat reference just as "every step done" binds a sequence. Thus an all-reference document still carries an exhaustiveness bar.

The strongest criteria are both checkable and exhaustive.

## When to split

A split of one document into two spends one of the two loads. Split only when the cut earns this cost.

- By sequence: split a run of steps when the post-completion steps tempt the agent to rush the current step. Keep them out of view to drive more legwork on the current task. Beware the reverse. A merged sequence exposes each later step to what follows. This invites premature completion.
- By invocation: this split is skill-specific. See [references/skill-mechanics.md](references/skill-mechanics.md).

## Leading words

A leading word is a compact concept that already lives in the pretraining of the model. The agent thinks with it while it runs the document. Examples are lesson, fog of war, and tracer bullets. Repeat the word as a token, never as a sentence. It accumulates a distributed definition. It also anchors a whole region of behaviour in the fewest tokens. It recruits priors that the model already holds. A word that you coin works if you define it clearly. A made-up word recruits no priors. You pay in definition tokens what a pretrained word gives free. Reach for an existing word first.

A leading word anchors twice. In the body, it anchors execution. The agent reaches for the same behaviour every time the word appears. Inside flat reference, it focuses attention on a class of thing to look for. In a pointer, it anchors invocation. When the same word lives in your prompts, your docs, and your codebase, the agent links that shared language to the material. It then reaches the material more reliably.

Hunt for opportunities to refactor with leading words. A triad that you spell out at three sites is one opportunity. A pointer that spends a sentence to gesture at one idea is another. Each is a passage that begs to collapse into a single token.

- "fast, deterministic, low-overhead" becomes tight (a tight loop).
- "a loop you believe in" becomes red. This turns a fuzzy gate into a binary observable state. The loop goes red on the bug, or it does not.

You win twice. You use fewer tokens. You also give the agent a sharper hook for its thinking. Assume every document carries restatements that leading words retire. Go find them.

Negation is the failure mode beside this lever. A prohibition steers by negation. It drags the forbidden behaviour into context. It makes the behaviour more available, not less. If you say "do not think of an elephant", the elephant is all there is. The negation is a weak modifier. The strongly active concept overruns it. The ban half-reads as an instruction to do the thing. Prompt the positive. State the target behaviour, for example "write one-line comments". Thus you never speak the banned behaviour. A prohibition earns its place only as a hard guardrail that you cannot phrase positively. Even then, pair it with the positive target. Thus attention lands on what to do.

## Pruning

Keep each meaning in a single source of truth. It is one authoritative place, so a change to the behaviour is a one-place edit. Duplication puts the same meaning in more than one place. It costs maintenance and tokens. It also inflates the prominence of the meaning on the ladder beyond its real rank. Duplication is the accidental inverse of a leading word. A leading word repeats a token on purpose, never the meaning.

The environment is a source of truth too. Examples are `package.json` scripts, config files, the directory layout, and `--help` output. A document that restates the environment is a cache. It is a copy of a lookup. It earns its load only when the lookup is expensive. Cache what the agent cannot find directly. Examples are the unwritten convention, the reason behind a choice, and the gotcha that no config confesses. Leave the one-file, one-command lookups to the environment. There they cannot go stale.

Check every line for relevance. Does the line still bear on what the document does? A line loses relevance in two ways. It never bears on the task, because it is mere exposition or a branch that belongs behind a pointer. Or it goes stale as the behaviour or the world that it describes changes. Shorter documents are easier to keep relevant. Without a pruning discipline, the default fate is sediment. Stale layers settle because it feels safe to add and risky to remove. Then you must core down through them to find what is still live.

Hunt no-ops sentence by sentence. A no-op is an instruction that the model already obeys by default. It pays load to say nothing. The test asks whether the instruction changes behaviour against the default. The test is model-relative, not reader-relative. Two people who disagree about a no-op disagree about the default. Run the document to settle the disagreement. Do not debate it. If a sentence fails the test, delete the whole sentence. Do not trim words from it. The test also grades leading words. A word that is too weak to beat the default is a no-op. An example is "be thorough" when the agent is already thorough-ish. The fix is a stronger word such as "relentless", not a different technique.
