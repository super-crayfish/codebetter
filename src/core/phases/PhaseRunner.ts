import * as vscode from 'vscode';
import OpenAI from 'openai';
import { PhaseContext, PhaseResult } from '../types';
import { McpRegistry } from '../mcp/McpRegistry';

export class PhaseRunner {
    private history: PhaseResult[] = [];
    private mcpRegistry: McpRegistry;

    constructor() {
        this.mcpRegistry = new McpRegistry();
    }

    private getLLMClient() {
        const config = vscode.workspace.getConfiguration('traycer');
        const apiKey = config.get<string>('apiKey');
        const baseURL = config.get<string>('apiBaseUrl');

        if (!apiKey) {
            throw new Error('API Key not found. Please set traycer.apiKey in settings.');
        }

        return new OpenAI({
            apiKey,
            baseURL
        });
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
            switch (type) {
                case 'review':
                    output = await this.runReview(context);
                    break;
                case 'plan':
                    output = await this.runPlan(context);
                    break;
                case 'phases':
                    output = "Analyzing project phases... Focus areas: Context discovery and intent clarification.";
                    break;
            }
        } catch (err: any) {
            output = `Error: ${err.message}`;
        }

        const result: PhaseResult = {
            phase: type,
            output,
            timestamp: Date.now()
        };

        this.history.push(result);
        return result;
    }

    private async runReview(context: PhaseContext): Promise<string> {
        return this.chatWithTools([
            { role: 'system', content: 'You are a code review agent. Analyze the provided context and files mentioned.' },
            { role: 'user', content: `Context: ${JSON.stringify(context.mcpContext)}\nReview the current workspace state.` }
        ]);
    }

    private async runPlan(context: PhaseContext): Promise<string> {
        return this.chatWithTools([
            { role: 'system', content: 'You are a technical architect. Create a step-by-step implementation plan using available tools.' },
            { role: 'user', content: `Context: ${JSON.stringify(context.mcpContext)}\nHelp me plan my next steps.` }
        ]);
    }

    private async chatWithTools(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<string> {
        const client = this.getLLMClient();
        const config = vscode.workspace.getConfiguration('traycer');
        const model = config.get<string>('model') || 'gpt-4o';

        // Prepare tools for LLM
        const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = this.mcpRegistry.getAllTools().map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }));

        let currentMessages = [...messages];

        while (true) {
            const response = await client.chat.completions.create({
                model,
                messages: currentMessages,
                tools: openaiTools.length > 0 ? openaiTools : undefined
            });

            const assistantMessage = response.choices[0].message;
            currentMessages.push(assistantMessage as any);

            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                return assistantMessage.content || '';
            }

            // Execute tool calls
            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.type !== 'function') {
                    continue;
                }

                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                try {
                    console.log(`Executing tool: ${functionName} with args: ${JSON.stringify(args)}`);
                    const result = await this.mcpRegistry.executeTool(functionName, args);
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    } as any);
                } catch (err: any) {
                    console.error(`Tool execution failed: ${err.message}`);
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ error: err.message })
                    } as any);
                }
            }
            // Loop continues to send tool results back to the LLM
        }
    }

    public getHistory(): PhaseResult[] {
        return [...this.history];
    }
}
