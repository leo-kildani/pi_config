---
name: writing-in-ste
description: Writes and simplifies text with Simplified Technical English (ASD-STE100) principles. Use when writing or editing context files, technical documents, and operator responses.
---

# Writing in STE

## Overview

Write or edit text with Simplified Technical English (ASD-STE100) principles. Keep the text direct, clear, and unambiguous. Ignore this skill when you write code.

## Rules

1. Maintain Content Fidelity
   - Preserve technical identifiers, error codes, parameter names, and URLs exactly. A changed identifier becomes a new entity.
   - Do not alter safety warnings or negative constraints (for example, `must not`, `do not`, `never`).
   - Preserve hedges exactly (for example, `may`, `might`, `possible`).
   - Do not convert probability into certainty.
2. Enforce Strict Syntax and Structure
   - Use active voice in the pattern `[Actor] [Action] [Object]` (for example, write "The daemon writes the PID", not "The PID is written by the daemon").
   - Keep one idea per sentence.
   - Do not join clauses with a semicolon, an em dash, or a chaining conjunction (for example, `and`, `while`, `as well as`).
   - Keep noun clusters to three nouns or fewer. Use prepositions to disambiguate a longer cluster (for example, write "Filter for the fuel pump", not "Fuel pump filter assembly bracket").
   - Use numbered steps for sequential procedures.
   - Use bulleted lists only for three or more parallel items.
   - Use a checklist for a list of tasks.
3. Ensure Lexical Precision
   - Use active root verbs instead of nominalized noun phrases (for example, write "Verify the key", not "Perform verification of the key").
   - Assign one fixed term per entity. Do not rotate synonyms (for example, do not interchange `client`, `caller`, and `user`).
   - Do not use unverifiable fluff adjectives or adverbs (for example, `seamless`, `blazing-fast`, `robust`, `easily`, `simply`).
   - Use objective, literal descriptions.
4. Restrict Sentence Length
   - Keep procedural instructions to 20 words or fewer.
   - Keep descriptive text to 25 words or fewer.
   - Split an overly long sentence into two clear sentences.
5. Simplify Verb Tenses and Moods
   - Use simple tenses (simple present, simple past).
   - Do not use complex compound tenses (for example, `have configured`, `had completed`).
   - Do not use the future tense (`will`, `shall`).
   - Use the imperative mood for procedural steps (for example, write "Open the valve", not "The valve should be opened").
6. Restrict Ambiguous `-ing` Forms
   - Do not use an `-ing` word as a main verb or a participle. Do not string sequential actions with `-ing` (for example, write "Remove the panel, then disconnect the cable", not "Removing the panel, disconnect the cable").
   - Use `-ing` forms only as technical nouns or established modifiers within a noun cluster (for example, `landing gear`, `cooling system`).

## Output Contract

- Return only the rewritten text. Do not emit conversational preamble, sign-offs, or rationale.
- You must retain the original phrase when simplification risks ambiguous technical execution or safety. Append this format:
```text
[Retained: "<original-text>" - Reason: "<operational-ambiguity>"]
```
- Audit Mode: Return only the markdown table below, then the enumerated rewritten text, when the operator requests a diff or rationale:
```markdown
| # | Original Fragment | Revised Fragment | Rule Applied |
| --- | --- | --- | --- |
```
