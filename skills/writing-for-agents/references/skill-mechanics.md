# Skill Mechanics

Reference for the package mechanics of a filesystem agent skill. Read this file when you create, edit, or review a `SKILL.md` package.

## Workflow

1. Confirm the target. Identify the agent runtime, skill location, audience, and task. Check local conventions. Do not assume that paths or optional metadata fields work across runtimes.
2. Define the purpose. Describe the task, the activation conditions, and the result. Keep one coherent capability per skill. Split distinct tasks that have different triggers or procedures.
3. Choose the structure. Start with `SKILL.md`. Add references, scripts, or templates only when they make the skill clearer or more reliable.
4. Write the metadata and the instructions. See "Metadata and discovery" and "Skill body" below.
5. Review the package. Use the checklist below to check clarity, structure, references, scripts, and runtime assumptions.

## Package structure

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

Use the directory layout that the target runtime supports. Keep references directly discoverable from `SKILL.md`. Prefer a flat structure. Avoid reference chains that hide important instructions. For larger collections, add an index with a direct link from `SKILL.md`.

## Metadata and discovery

The supported metadata fields vary by runtime. For portable Agent Skills, use the common core: `name` and `description`. Add runtime-specific fields only when the target runtime supports them and they serve a clear purpose.

For runtimes that follow the Agent Skills core format:

- The format requires `name`. Use lowercase letters, numbers, and hyphens. Keep it within the format's 64-character limit. Choose a concise name that describes the capability.
- The format requires a non-empty `description` with a maximum of 1,024 characters. Do not include XML tags.
- Write the description in third person. State both what the skill does and when to use it. Use specific task terms and likely operator phrasing.
- Make activation conditions explicit. List the important request types and contexts, not only a broad topic label.
- Keep the directory name consistent with `name` when the runtime expects this.

Treat the description as routing metadata, not a full summary of the instructions. State clearly and directly when the skill applies. Avoid vague phrases such as "helps with". Do not make the skill sound relevant to unrelated tasks.

## Skill body

Start the body with an H1 that matches the skill name in readable title case. Then add an H2 overview. State the capability and the result that it supports.

Organize the instructions with meaningful headings. Use a short workflow for sequential work. Use decision points for conditional work. Use examples when they clarify expected inputs or outputs.

Keep `SKILL.md` focused on the core procedure and navigation. Move extensive examples, specialized workflows, and detailed lookup material into focused reference files. Link each reference directly from the relevant section of `SKILL.md`, and state when to read it. Keep essential instructions in the main file. Apply `skill:writing-for-agents` to the structure and the wording.

## Reference files

Name references by topic and give each one a clear purpose. Add a brief description at the top. For long references, add a contents list. Use relative paths with forward slashes and confirm that every referenced file exists. Avoid deeply nested references.

### Referencing other skills

Reference another skill with `skill:<skill-name>`, and use its exact name. Mark dependencies clearly as **REQUIRED BACKGROUND** or **REQUIRED SUB-SKILL**, and state what the reader must do with the skill. Label related but non-required skills as optional.

Use a Markdown link only for a file in the same skill directory as the linking file. For all other skill references, use `skill:<skill-name>`. Do not use filesystem paths or another runtime's alias or force-load syntax.

Use `- [ ]` for every item in any checklist. Plain bullets do not communicate checkable completion state.

## Scripts

Use scripts for deterministic operations where exact, repeatable behavior is more reliable than natural-language instructions. Good candidates include mechanical format checks, file transformations, and fixed command sequences. Keep contextual decisions and subjective judgments in the instructions.

For each script, document its purpose, inputs, outputs, dependencies, and how to invoke it. Handle expected failures with clear messages and safe behavior. Validate inputs and scope file access. Do not add dependencies or configuration values without explaining their purpose.

## Review checklist

### Core quality

- [ ] The name describes one coherent capability and follows the target runtime's format.
- [ ] The description states what the skill does and when it activates.
- [ ] The description uses specific request language.
- [ ] The overview, headings, workflow, and examples make the instructions easy to navigate.
- [ ] The instructions cover relevant variations and edge cases and do not overfit one phrasing or project.
- [ ] `SKILL.md` stays focused.
- [ ] Each section links the supporting detail that it needs.
- [ ] Skill references use `skill:<skill-name>` with exact names.
- [ ] Use Markdown links only for files in the same skill directory.

### Code and scripts

- [ ] Use scripts for deterministic operations, not for decisions that need context or judgment.
- [ ] Each script has a clear purpose, documented inputs and outputs, dependencies, and invocation.
- [ ] Scripts validate inputs, handle expected failures clearly, and use safe, scoped file access.
- [ ] Each configuration value and dependency has a reason.
- [ ] Do not add unexplained constants.
- [ ] References, templates, and script paths exist and match the documented names.
- [ ] The package uses only metadata and capabilities supported by the intended runtime.
