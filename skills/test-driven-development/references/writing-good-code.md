# Writing Good Code

## Usage Scope

**Load this reference when:** writing production code, meaning the implementation that solves a test. Code under test, implementation, and solution are the same thing. 
**Do NOT load when:** writing test files. For tests, read [writing-good-tests.md](writing-good-tests.md).

## Overview

**Core Principle:** Reach for the laziest solution that works. Lazy means efficient, not careless. The best code is the code you never write. The smallest correct change is the right change.

## The Production Ladder

**Stop at the first rung that holds:**

1. **Does it need to exist?** A speculative need is not a need. Skip it. Say so in one line.
2. **Does this codebase already have it?** Reuse the helper, type, or pattern a few files over. Re-implementing what already lives here is the most common waste. Look before you write.
3. **Does the standard library do it?** Use it.
4. **Does a native feature cover it?** A platform date input beats a picker library. A database constraint beats application code. CSS beats JavaScript.
5. **Does an installed dependency solve it?** Use it. Do not add a new dependency when a few lines will do.
6. **Can it be one line?** Make it one line.
7. **Only then:** write the minimum code that works.

**Ladder Application:** The ladder is a reflex, not a research project. Run it after you understand the problem. Read the task and the code it touches first. Trace the real flow end to end. Then climb. 
- Two rungs hold? ALWAYS take the higher one and move on. 
- Genuinely unclear which rung applies, even after tracing the flow? ALWAYS state so in one line and take the lower, safer rung rather than guessing upward.

**Bug Fix Rule:** Fix the root cause, not the symptom. A report names a symptom. Before you edit, search every caller of the function you will touch. The lazy fix is the root-cause fix. One guard in the shared function is a smaller change than a guard in every caller. Patching only the path the ticket names leaves every sibling caller broken. Fix it once, where all callers route through.

## The Five Laws

**Five laws keep code good. The ladder applies them:**

- **KISS (Keep It Simple):** ALWAYS prefer the simple design over the clever one. A 50-line script beats a 500-line architecture. First make it work. Then make it right. Optimize only when a measurement demands it — not before. When in doubt, choose clarity over cleverness. Code should document itself.
- **POLA (Principle of Least Astonishment):** Code behaves the way a reader expects. ALWAYS follow platform conventions and common naming. Avoid surprising side effects and hidden defaults. A deviation needs a comment that names the reason.
- **DRY (Don't Repeat Yourself):** Every piece of knowledge gets one authoritative home. Fix a business rule in one place, not five. DRY targets repeated intent, not similar-looking code. Two blocks that look alike but change for different reasons are not duplicates. Do not merge them.
- **Law of Demeter (Don't Talk to Strangers):** An object talks to its direct collaborators, its parameters, and the objects it creates. It does not reach through them. ALWAYS prefer `order.total()` over `order.getCustomer().getCart().getTotal()`. Count the dots in a call chain. Fewer is better. Reach-through couples your code to a structure it does not own.
- **YAGNI (You Aren't Gonna Need It):** NEVER build for a need that has not arrived. No hook for a future caller. No flag for a case that does not exist. No config for a value that never changes. Good tests make a later addition cheap. Delay the design decision until demand appears.

## Rules

- **No unrequested abstraction:** No interface with one implementation. No factory for one product. No config for a value that never changes.
- **No boilerplate:** No scaffolding "for later". Later can scaffold for itself.
- **Deletion over addition:** Boring over clever. Clever is what someone decodes at 3am.
- **Fewest files possible:** The shortest working change wins, but only after you understand the problem. The smallest change in the wrong place is a second bug.
- **Complex requests:** Ship the minimal version and question it in the same response. Say "I did X. Y covers it. Need full X? Say so." NEVER stall on an answer you can default.
- **Standard-library options:** Two options, same size? ALWAYS take the one that is correct on edge cases. Lazy means less code, not a flimsier algorithm.
- **Mark deliberate simplifications:** Mark a deliberate simplification that cuts a real corner with a known ceiling using a `lazy:` comment. Name the ceiling and the upgrade path. Example: `# lazy: global lock; use per-account locks if throughput matters`.

## Output Format

Code first. Then at most three short lines: what you skipped, and when to add it.

**Pattern:** `[code] → skipped: [X], add when [Y].`

**Constraints:** No essays. No feature tours. No design notes. If the explanation is longer than the code, cut the explanation. Every paragraph that defends a simplification is complexity smuggled back in as prose. An explanation the operator asked for is not debt. Give it in full.

## Warning Signs

- An interface, factory, or config entry with exactly one user.
- A helper you wrote that already exists a few files over.
- A new dependency for what a few lines can do.
- A call chain with more than two dots.
- The same rule written in two places.
- A name that surprises its reader.
- A parameter, flag, or branch that no current caller needs.
- An abstraction introduced before its second use.
- A new file added when an existing file had room.

## When Not to Be Lazy

**Never simplify away:**
- Input validation at trust boundaries.
- Error handling that prevents data loss.
- Security measures.
- Accessibility basics.
- Calibration or tolerance for values that come from outside the program's control — a sensor reading, a clock, a third-party response — where a minimal model can't see the drift a real system needs tuned for.
- Anything the operator explicitly requested.

**Operator Overrides:** The operator insists on the full version? Build it. Do not re-argue. This is the same override pattern as TDD: an explicit, direct instruction from the operator, not a rationalization you invent.

**Comprehension:** NEVER be lazy about understanding the problem. The ladder shortens the solution, never the reading. Trace every file the change touches before you pick a rung. Laziness that skips comprehension ships a confident wrong fix.

## Boundaries

This reference governs what you build, not how you talk. The operator says "normal mode"? Revert to their preferred style.

**The shortest path to done is the right path.**
