---
name: writing-in-ste
description: Write and simplify text using Simplified Technical English principles. Use when writing or editing context files, technical documents, and operator responses.
---

# Writing in STE

## Overview

Write or edit text in a direct, clear, and unambiguous manner using Simplified Technical English (ASD-STE100) principles.

## Rules

1. Maintain Content Fidelity
   - NEVER drop technical identifiers, error codes, parameter names, or URLs
   - NEVER alter safety warnings or negative constraints (e.g., `must not`, `do not`, `never`)
   - ALWAYS preserve hedges exactly (e.g., `may`, `might`, `possible`) and NEVER convert probability to certainty
2. Enforce Strict Syntax and Structure
   - ALWAYS use active voice in the structure of `[Actor] [Action] [Object]` (e.g., ALWAYS write "The daemon writes the PID", and NEVER write "The PID is written by the daemon")
   - ALWAYS restrict sentences to one idea; NEVER join clauses with semicolons, em dashes, or chaining conjunctions (e.g., `and`, `while`, `as well as`)
   - NEVER exceed a maximum of 3 consecutive nouns in a noun cluster; ALWAYS use prepositions to disambiguate longer clusters (e.g., ALWAYS write "Filter for the fuel pump", and NEVER write "Fuel pump filter assembly bracket")
   - ALWAYS use numbered steps for sequential procedures and bulleted lists exclusively for 3 or more parallel items
3. Ensure Lexical Precision
   - ALWAYS use active root verbs instead of nominalized noun phrases (e.g., ALWAYS write "Verify the key", and NEVER write "Perform verification of the key")
   - ALWAYS assign one fixed term per entity and NEVER rotate synonyms (e.g., NEVER interchange `client`, `caller`, and `user`)
   - NEVER use unverifiable fluff adjectives or adverbs (e.g., `seamless`, `blazing-fast`, `robust`, `easily`, `simply`); ALWAYS use objective, literal descriptions
4. Restrict Sentence Length
   - NEVER exceed a maximum of 20 words per sentence for procedural instructions, or 25 words for descriptive text
   - ALWAYS split overly long sentences into two distinct thoughts rather than cramming details together
5. Simplify Verb Tenses and Moods
   - ALWAYS use simple tenses (simple present, simple past) and NEVER use complex compound tenses (e.g., avoid present/past perfect like `have configured` or `had completed`)
   - NEVER use the future tense (`will`, `shall`) and ALWAYS use the simple present or imperative instead
   - ALWAYS use the imperative mood (direct command) for all procedural steps (e.g., ALWAYS write "Open the valve", and NEVER write "The valve should be opened")
6. Restrict Ambiguous `-ing` Forms
   - NEVER use an `-ing` word as a main verb, participle, or to string together sequential actions (e.g., NEVER write "Removing the panel, disconnect the cable")
   - ALWAYS use `-ing` forms exclusively as technical nouns or established modifiers within a noun cluster (e.g., `landing gear`, `cooling system`)

## Output Contract

- **Default Behavior**: ALWAYS return only the rewritten text and NEVER emit conversational preamble, sign-offs, or rationale
- **Safety Lockout**: ALWAYS retain the original phrase if simplifying risks ambiguous technical execution or safety and ALWAYS append the following format:
```text
[Retained: "<original-text>" - Reason: "<operational-ambiguity>"]`
```
- **Audit Mode**: ONLY return the markdown table below followed by the rewritten text when the user explicitly requests a diff or rationale:
```markdown
| Original Fragment | Revised Fragment | Rule Applied |
| --- | --- | --- |
```
