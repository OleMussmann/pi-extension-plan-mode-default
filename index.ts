/**
 * Plan Mode Extension — Default Active Variant
 *
 * Based on the Plan Mode Extension from pi by Mario Zechner / Earendil Works.
 * Original: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode
 *
 * Modifications: plan mode is active by default; refactored to a two-state model
 * (plan vs. execution) with improved session restoration and GUI indicators.
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan and /exec commands to explicitly enter plan or execution mode
 * - Ctrl+Alt+M keyboard shortcut to toggle between modes
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

// Builtins permitted in plan mode (read-only, no file modification)
const PLAN_SAFE_BUILTINS = new Set(["read", "bash", "grep", "find", "ls"]);

// Non-builtin (extension) tools explicitly permitted in plan mode.
// MCP tools are intentionally excluded — they can execute shell commands or
// mutate system state. Add only known read-only extension tools here.
const PLAN_SAFE_EXTENSION_TOOLS = new Set([
	// pi-web-access
	"web_search",
	"code_search",
	"fetch_content",
	"get_search_content",
	// pi-pretty
	"multi_grep",
	// rpiv-ask-user-question
	"ask_user_question",
]);

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let todoItems: TodoItem[] = [];

	pi.registerFlag("exec", {
		description: "Start in execution mode (full tool access). Plan mode is the default.",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (!planModeEnabled && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", "📝 plan"));
		} else {
			// Execution mode without an active plan
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "🚀 exec"));
		}

		// Widget showing todo list
		if (!planModeEnabled && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function getPlanModeTools(): string[] {
		return pi.getAllTools()
			.filter(t => {
				if (t.sourceInfo.source === "builtin") return PLAN_SAFE_BUILTINS.has(t.name);
				return PLAN_SAFE_EXTENSION_TOOLS.has(t.name);
			})
			.map(t => t.name);
	}

	function getNormalModeTools(): string[] {
		return pi.getAllTools().map(t => t.name);
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.notify("Already in plan mode.", "info");
			return;
		}
		planModeEnabled = true;
		// Entering plan mode: abandon any active execution plan
		todoItems = [];
		const planTools = getPlanModeTools();
		pi.setActiveTools(planTools);
		ctx.ui.notify(`Plan mode enabled. Tools: ${planTools.join(", ")}`);
		updateStatus(ctx);
	}

	function enterExecutionMode(ctx: ExtensionContext): void {
		if (!planModeEnabled) {
			ctx.ui.notify("Already in execution mode.", "info");
			return;
		}
		planModeEnabled = false;
		// Entering execution mode: keep any existing plan
		pi.setActiveTools(getNormalModeTools());
		ctx.ui.notify("Execution mode. Full access restored.");
		updateStatus(ctx);
	}

	function toggleMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			enterExecutionMode(ctx);
		} else {
			enterPlanMode(ctx);
		}
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
		});
	}

	pi.registerCommand("plan", {
		description: "Enter plan mode (read-only exploration)",
		handler: async (_args, ctx) => enterPlanMode(ctx),
	});

	pi.registerCommand("exec", {
		description: "Enter execution mode (full tool access)",
		handler: async (_args, ctx) => enterExecutionMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("m"), {
		description: "Toggle between plan and execution mode",
		handler: async (ctx) => toggleMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /exec to switch to execution mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				// UI-only messages — never feed to LLM
				if (msg.customType === "plan-todo-list") return false;
				if (msg.customType === "plan-complete") return false;
				if (msg.customType === "plan-mode-execute") return false;
				if (msg.customType === "plan-execution-context") return false;
				if (msg.customType === "plan-mode-context") return false;
				// When not in plan mode, strip stale plan-mode prompts from user messages
				if (planModeEnabled || msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts.
	// Tool list is re-evaluated here on every turn to pick up MCP tools that
	// register asynchronously after session_start.
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			pi.setActiveTools(getPlanModeTools());
		} else {
			pi.setActiveTools(getNormalModeTools());
		}

		if (planModeEnabled && todoItems.length > 0) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode. A plan has already been created and is displayed above.

Do NOT respond. Do NOT create a new plan.
Wait for the user to switch to execution mode with /exec.`,
					display: false,
				},
			};
		}

		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Available tools:
- \`read\` — Read local file contents (NOT URLs, NOT \`file:///\`)
- \`ls\` — List directory contents
- \`find\` — Find files by name/pattern
- \`grep\` — Search file contents
- \`bash\` — Read-only commands (git status, cat, pwd, etc.)
- \`web_search\` / \`fetch_content\` — Web research (use ONLY after local exploration)
- \`ask_user_question\` — Ask clarifying questions

Restrictions:
- You CANNOT use: edit, write, fetch file:///
- Bash is restricted to read-only commands; destructive operations are blocked
- MCP tools are not available in plan mode

Behavioral rules:
1. Explore locally first — use read/ls/find/grep before web search
2. Never search from \`/\` or \`/nix/store\` — too large, too slow
3. If you need to search outside the current project directory, ask the user first

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (planModeEnabled || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (todoItems.length > 0 && todoItems.every((t) => t.completed)) {
			const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
			pi.sendMessage(
				{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
				{ triggerTurn: false },
			);
			todoItems = [];
			updateStatus(ctx);
			persistState(); // Save cleared state so resume doesn't restore old execution plan
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		let extracted: TodoItem[] = [];
		if (lastAssistant) {
			extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps only when the current assistant message created a new plan
		if (extracted.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		// Find the last persisted plan-mode entry
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[] } } | undefined;

		// Tier 1: Resume interrupted execution plan
		if (planModeEntry?.data?.todos && planModeEntry.data.todos.length > 0) {
			todoItems = planModeEntry.data.todos;
			planModeEnabled = false;

			// Re-scan messages to rebuild completion state
			// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}
		// Tier 2: Explicit opt-in to execution mode
		else if (pi.getFlag("exec") === true) {
			planModeEnabled = false;
			todoItems = [];
		}
		// Tier 3: Default — start in plan mode
		else {
			planModeEnabled = true;
			todoItems = [];
		}

		if (planModeEnabled) {
			pi.setActiveTools(getPlanModeTools());
		} else {
			pi.setActiveTools(getNormalModeTools());
		}
		updateStatus(ctx);
	});
}
