---
name: writing-agent-skills
description: Creates, edits, and reviews filesystem-based agent skills such as SKILL.md packages. Use when designing skill instructions, improving skill discovery or structure, adding references or scripts, auditing skill content, or preparing a skill for deployment.
---

# Writing Agent Skills

## Overview

Create concise, discoverable skills that help agents complete a specific, repeatable task. Focus on clear activation, useful instructions, and a structure that gives the agent the right detail at the right time.

## Workflow

1. **Confirm the target.** Identify the agent runtime, skill location, audience, and task. Check local conventions. Do not assume that paths or optional metadata fields work across runtimes.
2. **Define the purpose.** Describe the task, when the skill should activate, and the result it should guide. Keep one coherent capability per skill; split distinct tasks with different triggers or procedures.
3. **Choose the structure.** Start with `SKILL.md`. Add references, scripts, or templates only when they make the skill clearer or more reliable.
4. **Write metadata and instructions.** Make the description easy to match to user requests. Give direct instructions, explain the reasoning behind important choices, and match specificity to task risk.
5. **Review the package.** Use the checklist below to check clarity, structure, references, scripts, and runtime assumptions.

## Skill package structure

A minimal skill has one required file:

```text
skill-name/
└── SKILL.md
```

Add supporting files only when needed:

```text
skill-name/
├── SKILL.md
├── references/   # Detailed guidance or lookup material
├── scripts/      # Deterministic operations
└── templates/    # Reusable output or input structures
```

Use the directory layout supported by the target runtime. Keep references directly discoverable from `SKILL.md`. Prefer a flat structure; avoid reference chains that hide important instructions. For larger collections, add an index linked directly from `SKILL.md`.

## Metadata and discovery

The supported metadata fields vary by runtime. For portable Agent Skills, use the common core: `name` and `description`. Add runtime-specific fields only when the target runtime supports them and they serve a clear purpose.

For runtimes that follow the Agent Skills core format:

- `name` is required, lowercase, and uses letters, numbers, and hyphens. Keep it within the format's 64-character limit. Choose a concise name that describes the capability.
- `description` is required, non-empty, and within the format's 1,024-character limit. Do not include XML tags.
- Write the description in third person. State both what the skill does and when to use it. Use specific task terms and likely user phrasing.
- Make activation conditions explicit. Include the important request types and contexts, not just a broad topic label.
- Keep the directory name consistent with `name` when the runtime expects this.

Treat the description as routing metadata, not a full summary of the instructions. Be clear and direct about when the skill applies. Avoid vague phrases such as “helps with” and avoid making the skill sound relevant to unrelated tasks.

## Write effective instructions

### State the purpose and outcome

Start the body with an H1 matching the skill name in readable title case, then an H2 overview. State the capability and the result it supports.

Organize instructions with meaningful headings. Use a short workflow for sequential work, decision points for conditional work, and examples when they clarify expected inputs or outputs.

### Explain the reason behind guidance

Give the agent enough rationale to apply the instruction when the exact situation was not anticipated. Prefer a clear principle and its reason over a rigid command with no context. Reserve MUST and NEVER for genuine binary constraints, such as safety or compliance requirements. Explain why a hard constraint matters when that is not self-evident.

### Match detail to the task

Use flexible guidance when the right approach depends on context. Give a preferred pattern when consistency matters but some variation is safe. Specify exact steps or commands when an operation is fragile or must be performed in a fixed way.

Write for intent, not one exact user phrase or project setup. Account for likely variations in requests and relevant edge cases. Refer to the target project's actual tools and conventions rather than assuming a particular stack.

### Keep each instruction useful

Assume the agent already has general knowledge. Include task-specific expertise, constraints, and decisions that improve the result. Remove generic explanations, repetition, and options that do not help the agent choose.

Keep `SKILL.md` focused. Move detailed material that applies only to a subset of tasks into references. A short skill is useful when each instruction earns its context cost; do not shorten it by removing essential steps.

## Progressive disclosure and supporting files

Use `SKILL.md` for the core procedure and navigation. Move extensive examples, specialized workflows, and detailed lookup material into focused reference files. Link each reference directly from the relevant section of `SKILL.md` and say when to read it. Keep essential instructions in the main file.

Name references by topic and give each one a clear purpose. Add a brief description at the top. For long references, add a contents list. Use relative paths with forward slashes and confirm every referenced file exists. Avoid deeply nested references.

### Referencing other skills

Reference another skill with `skill:<skill-name>`, using its exact name. Mark dependencies clearly as **REQUIRED BACKGROUND** or **REQUIRED SUB-SKILL**, and state what the reader must do with the skill. Label related but non-required skills as optional.

Use a Markdown link only when the referenced file is in the same skill directory as the file that contains the link. For all other skill references, use `skill:<skill-name>`; do not use filesystem paths or another runtime's alias or force-load syntax.

Use `- [ ]` for every item in any checklist. Plain bullets do not communicate checkable completion state.

Use scripts for deterministic operations where exact, repeatable behavior is more reliable than natural-language instructions. Good candidates include mechanical format checks, file transformations, and fixed command sequences. Keep contextual decisions and subjective judgments in the instructions.

For each script, document its purpose, inputs, outputs, dependencies, and how to invoke it. Handle expected failures with clear messages and safe behavior. Validate inputs and scope file access. Do not add dependencies or configuration values without explaining their purpose.

## Review checklist

### Core quality

- [ ] The name describes one coherent capability and follows the target runtime's format.
- [ ] The description states what the skill does and when it should activate, using specific request language.
- [ ] The overview, headings, workflow, and examples make the instructions easy to navigate.
- [ ] Guidance explains important reasons and leaves room for context where appropriate.
- [ ] Hard rules are limited to genuine non-negotiable constraints.
- [ ] The instructions cover relevant variations and edge cases without overfitting to one phrasing or project.
- [ ] Every section adds useful task-specific guidance; remove repetition and generic explanations.
- [ ] `SKILL.md` stays focused, and supporting detail is linked from the section that needs it.
- [ ] Skill references use `skill:<skill-name>` with exact names; Markdown links are used only for files in the same skill directory.

### Code and scripts

- [ ] Scripts are used for deterministic operations, not decisions that need context or judgment.
- [ ] Each script has a clear purpose, documented inputs and outputs, dependencies, and invocation.
- [ ] Scripts validate inputs, handle expected failures clearly, and use safe, scoped file access.
- [ ] Configuration values and dependencies have a stated reason; there are no unexplained constants.
- [ ] References, templates, and script paths exist and match the documented names.
- [ ] The package uses only metadata and capabilities supported by the intended runtime.
