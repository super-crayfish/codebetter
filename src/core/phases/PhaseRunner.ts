import * as vscode from 'vscode';
import { PhaseContext, PhaseResult } from '../types';
import { McpRegistry } from '../mcp/McpRegistry';
import { LLMClient, ChatMessage, ToolDefinition, ToolCall } from '../llm';
import { errorLogger, ErrorType } from '../utils';

// System prompts for different modes
const PLAN_SYSTEM_PROMPT = `You are a technical architect and implementation planner. Your role is to:
1. Analyze the user's request and workspace context
2. Create a detailed, step-by-step implementation plan
3. Identify files that need to be created or modified
4. Suggest best practices and potential pitfalls
5. Use available tools to explore the codebase when needed

Be specific, actionable, and consider edge cases.`;

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Your role is to:
1. Analyze the provided code and context
2. Identify potential bugs, security issues, and code smells
3. Suggest improvements for readability and maintainability
4. Check for best practices and design patterns
5. Use available tools to examine related files when needed

Be constructive and provide specific suggestions with examples.`;

const PHASES_SYSTEM_PROMPT = `You are a project analyst helping to clarify intent and break down tasks. Your role is to:
1. Understand the user's high-level goal
2. Ask clarifying questions if needed
3. Break down the task into manageable phases
4. Identify dependencies between phases
5. Suggest a logical order of execution

Focus on understanding before suggesting solutions.`;

export class PhaseRunner {
    private history: PhaseResult[] = [];
    private mcpRegistry: McpRegistry;
    private llmClient: LLMClient;

    constructor() {
        this.mcpRegistry = new McpRegistry();
        this.llmClient = new LLMClient();
    }

    public async executePhase(type: 'phases' | 'plan' | 'review', context: PhaseContext): Promise<PhaseResult> {
        console.log(`Executing phase: ${type}`);

        // Aggregate dynamic context from MCPs
        const dynamicContext = await this.mcpRegistry.aggregateContext(context);
        context.mcpContext = dynamicContext;

        const tools = this.mcpRegistry.getAllTools();
        console.log(`Available tools: ${tools.map(t => t.name).join(', ')}`);

        let output = '';

        try {
            const systemPrompt = this.getSystemPrompt(type);
            output = await this.chatWithToolLoop(systemPrompt, context);
        } catch (err: any) {
            const errorType = errorLogger.classifyError(err);
            errorLogger.logError(errorType, err.message, err, { phase: type });
            output = errorLogger.getUserFriendlyMessage(errorType, err.message);
        }

        const result: PhaseResult = {
            phase: type,
            output,
            timestamp: Date.now()
        };

        this.history.push(result);
        return result;
    }

    private getSystemPrompt(type: 'phases' | 'plan' | 'review'): string {
        switch (type) {
            case 'plan':
                return PLAN_SYSTEM_PROMPT;
            case 'review':
                return REVIEW_SYSTEM_PROMPT;
            case 'phases':
                return PHASES_SYSTEM_PROMPT;
            default:
                return PLAN_SYSTEM_PROMPT;
        }
    }

    private async chatWithToolLoop(systemPrompt: string, context: PhaseContext): Promise<string> {
        // Prepare tools for LLM
        const toolDefinitions: ToolDefinition[] = this.mcpRegistry.getAllTools().map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }));

        // Build initial messages
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { 
                role: 'user', 
                content: `Workspace Context:\n${JSON.stringify(context.mcpContext, null, 2)}\n\nPlease analyze and help me with my task.`
            }
        ];

        // Tool calling loop
        const maxIterations = 10; // Prevent infinite loops
        let iterations = 0;

        while (iterations < maxIterations) {
            iterations++;

            const response = await this.llmClient.chat(messages, toolDefinitions);

            // If no tool calls, return the final response
            if (!response.toolCalls || response.toolCalls.length === 0) {
                return response.content || '';
            }

            // Add assistant message with tool calls
            messages.push({
                role: 'assistant',
                content: response.content,
                tool_calls: response.toolCalls
            });

            // Execute each tool call and add results
            for (const toolCall of response.toolCalls) {
                const toolResult = await this.executeToolCall(toolCall);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult)
                });
            }
        }

        return 'Maximum tool iterations reached. Please try a simpler request.';
    }

    private async executeToolCall(toolCall: ToolCall): Promise<unknown> {
        const functionName = toolCall.function.name;
        let args: unknown;

        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch (err: any) {
            errorLogger.logError(ErrorType.TOOL_ERROR, `Failed to parse tool arguments`, err, { tool: functionName });
            return { error: `Failed to parse tool arguments: ${err.message}` };
        }

        try {
            console.log(`Executing tool: ${functionName} with args: ${JSON.stringify(args)}`);
            const result = await this.mcpRegistry.executeTool(functionName, args);
            return result;
        } catch (err: any) {
            errorLogger.logError(ErrorType.TOOL_ERROR, `Tool execution failed: ${functionName}`, err, { tool: functionName, args });
            return { error: err.message };
        }
    }

    public getHistory(): PhaseResult[] {
        return [...this.history];
    }

    public clearHistory(): void {
        this.history = [];
    }

    /**
     * Execute phase with streaming support
     * @param type Phase type
     * @param context Phase context
     * @param onChunk Callback for each streamed chunk
     */
    public async executePhaseStream(
        type: 'phases' | 'plan' | 'review',
        context: PhaseContext,
        onChunk: (chunk: string) => void
    ): Promise<PhaseResult> {
        console.log(`Executing phase (streaming): ${type}`);

        // Aggregate dynamic context from MCPs
        const dynamicContext = await this.mcpRegistry.aggregateContext(context);
        context.mcpContext = dynamicContext;

        let output = '';

        try {
            const systemPrompt = this.getSystemPrompt(type);
            output = await this.chatWithToolLoopStream(systemPrompt, context, onChunk);
        } catch (err: any) {
            output = `Error: ${err.message}`;
            onChunk(output);
        }

        const result: PhaseResult = {
            phase: type,
            output,
            timestamp: Date.now()
        };

        this.history.push(result);
        return result;
    }

    private async chatWithToolLoopStream(
        systemPrompt: string,
        context: PhaseContext,
        onChunk: (chunk: string) => void
    ): Promise<string> {
        // Prepare tools for LLM
        const toolDefinitions: ToolDefinition[] = this.mcpRegistry.getAllTools().map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }));

        // Build initial messages
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { 
                role: 'user', 
                content: `Workspace Context:\n${JSON.stringify(context.mcpContext, null, 2)}\n\nPlease analyze and help me with my task.`
            }
        ];

        // Tool calling loop with streaming
        const maxIterations = 10;
        let iterations = 0;
        let fullContent = '';

        while (iterations < maxIterations) {
            iterations++;

            let currentContent = '';
            let toolCalls: ToolCall[] | undefined;

            // Stream the response
            for await (const chunk of this.llmClient.chatStream(messages, toolDefinitions)) {
                if (chunk.content) {
                    currentContent += chunk.content;
                    fullContent += chunk.content;
                    onChunk(chunk.content);
                }
                if (chunk.done && chunk.toolCalls) {
                    toolCalls = chunk.toolCalls;
                }
            }

            // If no tool calls, we're done
            if (!toolCalls || toolCalls.length === 0) {
                return fullContent;
            }

            // Add assistant message with tool calls
            messages.push({
                role: 'assistant',
                content: currentContent || null,
                tool_calls: toolCalls
            });

            // Execute each tool call and add results
            for (const toolCall of toolCalls) {
                onChunk(`\n[Executing tool: ${toolCall.function.name}...]\n`);
                const toolResult = await this.executeToolCall(toolCall);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult)
                });
            }
        }

        return fullContent + '\n\nMaximum tool iterations reached.';
    }
}
