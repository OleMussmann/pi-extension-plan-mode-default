# Plan Mode Extension for pi-coding-agent

Read-only exploration mode for safe code analysis. Inspired by Claude Code's plan mode.

## Features

- **Read-only tools**: Restricts available tools to `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- **Bash allowlist**: Only read-only bash commands are allowed (e.g., `cat`, `grep`, `git status`)
- **Plan extraction**: Extracts numbered steps from `Plan:` sections in agent responses
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking by the agent
- **Session persistence**: State survives session resume

## Installation

### Option 1: Global (all projects)

```bash
# Clone or copy this extension into your extensions directory
git clone git@github.com:user/repo.git ~/.pi/agent/extensions/plan-mode-default
```

### Option 2: Project-local

```bash
git clone git@github.com:user/repo.git .pi/extensions/plan-mode-default
```

### Option 3: Via `pi install`

```bash
pi install git:github.com/user/repo
```

Then add to your `settings.json`:

```json
{
  "packages": [
    "git:github.com/user/repo"
  ]
}
```

### Option 4: Load directly

```bash
pi --extension ./path/to/plan-mode-default/index.ts
```

## Usage

Plan mode is **active by default** when pi starts. All sessions begin in read-only exploration mode.

1. Ask the agent to analyze code and create a plan
2. The agent should output a numbered plan under a `Plan:` header:

```markdown
Plan:
1. First step description
2. Second step description
3. Third step description
```

3. Choose "Execute the plan" when prompted, or switch to execution mode manually with `/exec`
4. During execution, the agent marks steps complete with `[DONE:n]` tags
5. Progress widget shows completion status in the footer

### Starting in execution mode

Use the `--exec` CLI flag to start pi with full tool access:

```bash
pi --exec
```

You can also switch between modes at any time with `/plan`, `/exec`, or `Ctrl+Alt+M`.

### Resuming sessions

Interrupted plans are automatically resumed when you restart pi. If a plan was in progress, the extension restores the remaining steps and re-enters execution mode.

## Commands

| Command | Description |
|---------|-------------|
| `/plan` | Enter plan mode (read-only exploration) |
| `/exec` | Enter execution mode (full tool access) |
| `/todos` | Show current plan progress |

## Keyboard Shortcut

| Shortcut | Description |
|----------|-------------|
| `Ctrl+Alt+M` | Toggle between plan and execution mode |

## How It Works

### Plan Mode (Read-Only)
- Only read-only tools available: `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- Bash commands filtered through allowlist — destructive operations are blocked
- Agent creates a plan without making changes to files

### Execution Mode
- Full tool access restored (`read`, `bash`, `edit`, `write`)
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress in the footer

## Command Allowlist

### Safe commands (allowed):
- **File inspection**: `cat`, `head`, `tail`, `less`, `more`
- **Search**: `grep`, `find`, `rg`, `fd`
- **Directory**: `ls`, `pwd`, `tree`
- **Git read**: `git status`, `git log`, `git diff`, `git branch`, `git show`
- **Package info**: `npm list`, `npm outdated`, `yarn info`
- **System info**: `uname`, `whoami`, `date`, `uptime`, `ps`

### Blocked commands:
- **File modification**: `rm`, `mv`, `cp`, `mkdir`, `touch`, `chmod`, `chown`
- **Git write**: `git add`, `git commit`, `git push`, `git reset`, `git checkout`
- **Package install**: `npm install`, `yarn add`, `pip install`, `apt install`
- **System**: `sudo`, `kill`, `reboot`, `shutdown`
- **Editors**: `vim`, `nano`, `emacs`, `code`

## Extension Compatibility

This extension filters tools by `sourceInfo.source` to distinguish builtins from extension-registered tools. **Extensions that rewrite builtin tools** (e.g., [pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty)) register replacements via `pi.registerTool()` with `source === "extension"`, which plan mode's allowlist does not recognize.

**Result:** Tools like `read`, `bash`, `ls`, `find`, `grep` disappear in plan mode when a rewriting extension is active.

### Workaround

Use pi-pretty's `PRETTY_DISABLE_TOOLS` env var to skip rewriting the tools plan mode manages:

```bash
PRETTY_DISABLE_TOOLS=read,bash,ls,find,grep pi
```

Or disable pi-pretty entirely when using plan mode:

```bash
# Unload pi-pretty temporarily
pi --no-extension pi-pretty
```

### Why this happens

Plan mode's `getPlanModeTools()` checks:

```typescript
if (t.sourceInfo.source === "builtin") return PLAN_SAFE_BUILTINS.has(t.name);
return PLAN_SAFE_EXTENSION_TOOLS.has(t.name);
```

pi-pretty's tools have `source === "extension"`, so they fall into the extension path and get filtered out since `read`, `bash`, etc. aren't in `PLAN_SAFE_EXTENSION_TOOLS`.

### For extension authors

If your extension rewrites builtin tool names, either:
- Use `PRETTY_DISABLE_TOOLS` equivalent to let users opt out
- Or open an issue requesting name-based allowlisting

## Acknowledgements

This project is based on the [Plan Mode Extension](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode)
from the [pi](https://github.com/earendil-works/pi) project by [Mario Zechner](https://github.com/badlogic) / Earendil Works.
The original code is licensed under the MIT License.

## License

MIT
