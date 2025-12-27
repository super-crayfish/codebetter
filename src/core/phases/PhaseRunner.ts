import { PhaseContext, PhaseResult } from '../types';

import { McpRegistry } from '../mcp/McpRegistry';

export class PhaseRunner {
    private history: PhaseResult[] = [];
    private mcpRegistry: McpRegistry;

    constructor() {
        this.mcpRegistry = new McpRegistry();
    }

    public async executePhase(type: 'phases' | 'plan' | 'review', context: PhaseContext): Promise<PhaseResult> {
        console.log(`Executing phase: ${type}`);

        // Aggregate dynamic context from MCPs
        const dynamicContext = await this.mcpRegistry.aggregateContext(context);
        context.mcpContext = dynamicContext;

        let output = '';

        switch (type) {
            case 'review':
                output = await this.runReview(context);
                break;
            case 'plan':
                output = await this.runPlan(context);
                break;
            case 'phases':
                output = "Analyzing project phases...";
                break;
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
        // Placeholder for ReviewEngine logic
        return "Review found 0 critical issues. Project looks healthy.";
    }

    private async runPlan(context: PhaseContext): Promise<string> {
        // Placeholder for TaskDecomposer logic
        return "Generated a 3-step plan for your task.";
    }

    public getHistory(): PhaseResult[] {
        return [...this.history];
    }
}
