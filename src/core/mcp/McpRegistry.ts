import { PhaseContext } from '../types';

export interface McpProvider {
    name: string;
    provideContext(ctx: PhaseContext): Promise<Record<string, unknown>>;
}

export class McpRegistry {
    private providers: McpProvider[] = [];

    constructor() {
        // Register default providers
        this.registerProvider(new GitMcpProvider());
    }

    public registerProvider(provider: McpProvider) {
        this.providers.push(provider);
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

class GitMcpProvider implements McpProvider {
    name = 'git';
    async provideContext(ctx: PhaseContext): Promise<Record<string, unknown>> {
        // Mock git context
        return {
            branch: 'main',
            modifiedFiles: [],
            lastCommit: 'Initial commit'
        };
    }
}
