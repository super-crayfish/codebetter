import { PhaseContext } from '../types';
import { FileSystemMcpProvider } from './providers/FileSystemMcpProvider';
import { GitMcpProvider } from './providers/GitMcpProvider';
import { spawn, ChildProcess } from 'child_process';

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

export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
}

/**
 * Provider for user-configured external MCP servers
 */
class ExternalMcpProvider implements McpProvider {
    name: string;
    private config: McpServerConfig;
    private process: ChildProcess | null = null;
    private connected: boolean = false;

    constructor(name: string, config: McpServerConfig) {
        this.name = name;
        this.config = config;
    }

    async provideContext(_ctx: PhaseContext): Promise<Record<string, unknown>> {
        return {
            serverName: this.name,
            connected: this.connected,
            command: this.config.command
        };
    }

    getTools(): McpTool[] {
        // External MCP servers would provide tools via the MCP protocol
        // For now, return empty array - full MCP client implementation would be needed
        return [];
    }

    async start(): Promise<void> {
        if (this.process || !this.config.command) {
            return;
        }

        try {
            console.log(`Starting MCP server: ${this.name} with command: ${this.config.command}`);
            
            this.process = spawn(this.config.command, this.config.args || [], {
                env: { ...process.env, ...this.config.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.process.on('error', (err) => {
                console.error(`MCP server ${this.name} error:`, err);
                this.connected = false;
            });

            this.process.on('exit', (code) => {
                console.log(`MCP server ${this.name} exited with code ${code}`);
                this.connected = false;
                this.process = null;
            });

            // Give it a moment to start
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.connected = true;
            console.log(`MCP server ${this.name} started`);
        } catch (err) {
            console.error(`Failed to start MCP server ${this.name}:`, err);
            this.connected = false;
        }
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.connected = false;
            console.log(`MCP server ${this.name} stopped`);
        }
    }
}

export class McpRegistry {
    private builtInProviders: McpProvider[] = [];
    private userProviders: Map<string, ExternalMcpProvider> = new Map();

    constructor() {
        // Register default built-in providers
        this.builtInProviders.push(new GitMcpProvider());
        this.builtInProviders.push(new FileSystemMcpProvider());
    }

    /**
     * Register a built-in provider
     */
    public registerProvider(provider: McpProvider): void {
        this.builtInProviders.push(provider);
    }

    /**
     * Register a user-configured MCP server
     */
    public registerUserMcpServer(name: string, config: McpServerConfig): void {
        // Stop existing server with same name if any
        const existing = this.userProviders.get(name);
        if (existing) {
            existing.stop();
        }

        const provider = new ExternalMcpProvider(name, config);
        this.userProviders.set(name, provider);
        
        // Start the server asynchronously
        provider.start().catch(err => {
            console.error(`Failed to start MCP server ${name}:`, err);
        });
    }

    /**
     * Clear all user-configured providers
     */
    public clearUserProviders(): void {
        for (const provider of this.userProviders.values()) {
            provider.stop();
        }
        this.userProviders.clear();
    }

    /**
     * Get all providers (built-in + user)
     */
    private getAllProviders(): McpProvider[] {
        return [...this.builtInProviders, ...Array.from(this.userProviders.values())];
    }

    /**
     * Get all available tools from all providers
     */
    public getAllTools(): McpTool[] {
        const tools: McpTool[] = [];
        for (const provider of this.getAllProviders()) {
            if (provider.getTools) {
                tools.push(...provider.getTools());
            }
        }
        return tools;
    }

    /**
     * Execute a tool by name
     */
    public async executeTool(toolName: string, args: any): Promise<any> {
        const tools = this.getAllTools();
        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }
        return await tool.execute(args);
    }

    /**
     * Aggregate context from all providers
     */
    public async aggregateContext(ctx: PhaseContext): Promise<Record<string, unknown>> {
        let fullContext: Record<string, unknown> = {};

        for (const provider of this.getAllProviders()) {
            try {
                const pCtx = await provider.provideContext(ctx);
                fullContext = { ...fullContext, [provider.name]: pCtx };
            } catch (err) {
                console.error(`Provider ${provider.name} failed:`, err);
            }
        }

        return fullContext;
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this.clearUserProviders();
    }
}
