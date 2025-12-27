import { PhaseContext } from '../types';
import { FileSystemMcpProvider } from './providers/FileSystemMcpProvider';
import { GitMcpProvider } from './providers/GitMcpProvider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
 * Provider for user-configured external MCP servers using the MCP SDK
 */
class ExternalMcpProvider implements McpProvider {
    name: string;
    private config: McpServerConfig;
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private connected: boolean = false;
    private tools: McpTool[] = [];

    constructor(name: string, config: McpServerConfig) {
        this.name = name;
        this.config = config;
    }

    async provideContext(_ctx: PhaseContext): Promise<Record<string, unknown>> {
        return {
            serverName: this.name,
            connected: this.connected,
            command: this.config.command,
            toolCount: this.tools.length
        };
    }

    getTools(): McpTool[] {
        return this.tools;
    }

    async start(): Promise<void> {
        if (this.client || !this.config.command) {
            return;
        }

        try {
            console.log(`Starting MCP server: ${this.name} with command: ${this.config.command} ${(this.config.args || []).join(' ')}`);
            
            // Create transport using stdio
            this.transport = new StdioClientTransport({
                command: this.config.command,
                args: this.config.args || [],
                env: { ...process.env, ...this.config.env } as Record<string, string>
            });

            // Create MCP client
            this.client = new Client({
                name: `traycer-${this.name}`,
                version: '1.0.0'
            }, {
                capabilities: {}
            });

            // Connect to the server
            await this.client.connect(this.transport);
            this.connected = true;
            console.log(`MCP server ${this.name} connected`);

            // Fetch available tools from the server
            await this.refreshTools();
            
        } catch (err) {
            console.error(`Failed to start MCP server ${this.name}:`, err);
            this.connected = false;
            await this.stop();
        }
    }

    /**
     * Refresh the list of tools from the MCP server
     */
    private async refreshTools(): Promise<void> {
        if (!this.client || !this.connected) {
            this.tools = [];
            return;
        }

        try {
            const result = await this.client.listTools();
            
            this.tools = (result.tools || []).map(tool => ({
                name: `${this.name}__${tool.name}`, // Prefix with server name to avoid conflicts
                description: tool.description || `Tool from ${this.name}`,
                inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                execute: async (args: any) => {
                    return this.executeTool(tool.name, args);
                }
            }));

            console.log(`MCP server ${this.name} provides ${this.tools.length} tools: ${this.tools.map(t => t.name).join(', ')}`);
        } catch (err) {
            console.error(`Failed to list tools from MCP server ${this.name}:`, err);
            this.tools = [];
        }
    }

    /**
     * Execute a tool on the MCP server
     */
    private async executeTool(toolName: string, args: any): Promise<any> {
        if (!this.client || !this.connected) {
            throw new Error(`MCP server ${this.name} is not connected`);
        }

        try {
            const result = await this.client.callTool({
                name: toolName,
                arguments: args
            });

            // Extract content from the result
            if (result.content && Array.isArray(result.content)) {
                const textContent = result.content.find((c: any) => c.type === 'text');
                if (textContent) {
                    try {
                        return JSON.parse(textContent.text);
                    } catch {
                        return textContent.text;
                    }
                }
                return result.content;
            }

            return result;
        } catch (err: any) {
            console.error(`Failed to execute tool ${toolName} on MCP server ${this.name}:`, err);
            throw new Error(`Tool execution failed: ${err.message}`);
        }
    }

    async stop(): Promise<void> {
        this.connected = false;
        this.tools = [];

        if (this.client) {
            try {
                await this.client.close();
            } catch (err) {
                console.error(`Error closing MCP client ${this.name}:`, err);
            }
            this.client = null;
        }

        if (this.transport) {
            try {
                await this.transport.close();
            } catch (err) {
                console.error(`Error closing MCP transport ${this.name}:`, err);
            }
            this.transport = null;
        }

        console.log(`MCP server ${this.name} stopped`);
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
    public async registerUserMcpServer(name: string, config: McpServerConfig): Promise<void> {
        // Stop existing server with same name if any
        const existing = this.userProviders.get(name);
        if (existing) {
            await existing.stop();
        }

        const provider = new ExternalMcpProvider(name, config);
        this.userProviders.set(name, provider);
        
        // Start the server
        try {
            await provider.start();
        } catch (err) {
            console.error(`Failed to start MCP server ${name}:`, err);
        }
    }

    /**
     * Clear all user-configured providers
     */
    public async clearUserProviders(): Promise<void> {
        const stopPromises: Promise<void>[] = [];
        for (const provider of this.userProviders.values()) {
            stopPromises.push(provider.stop());
        }
        await Promise.all(stopPromises);
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
    public async dispose(): Promise<void> {
        await this.clearUserProviders();
    }
}
