import { PhaseContext } from '../types';
import { FileSystemMcpProvider } from './providers/FileSystemMcpProvider';
import { GitMcpProvider } from './providers/GitMcpProvider';

export interface McpTool {
    name: string;
    description: string;
    inputSchema: any;
    execute(args: any): Promise<any>;
}

export interface McpProvider {
    name: string;
    provideContext(ctx: PhaseContext): Promise<Record<string, unknown>>;
    getTools?(): McpTool[];
}

export class McpRegistry {
    private providers: McpProvider[] = [];

    constructor() {
        // Register default providers
        this.registerProvider(new GitMcpProvider());
        this.registerProvider(new FileSystemMcpProvider());
    }

    public registerProvider(provider: McpProvider) {
        this.providers.push(provider);
    }

    public getAllTools(): McpTool[] {
        const tools: McpTool[] = [];
        for (const provider of this.providers) {
            if (provider.getTools) {
                tools.push(...provider.getTools());
            }
        }
        return tools;
    }

    public async executeTool(toolName: string, args: any): Promise<any> {
        const tools = this.getAllTools();
        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }
        return await tool.execute(args);
    }

    public async aggregateContext(ctx: PhaseContext): Promise<Record<string, unknown>> {
        let fullContext: Record<string, unknown> = {};

        for (const provider of this.providers) {
            try {
                const pCtx = await provider.provideContext(ctx);
                fullContext = { ...fullContext, [provider.name]: pCtx };
            } catch (err) {
                console.error(`Provider ${provider.name} failed:`, err);
            }
        }

        return fullContext;
    }
}
