import * as vscode from 'vscode';
import OpenAI from 'openai';

// Provider configurations with defaults (only OpenAI-compatible APIs)
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string; requiresApiKey: boolean }> = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        requiresApiKey: true
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        requiresApiKey: true
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        requiresApiKey: true
    },
    ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
        requiresApiKey: false
    },
    custom: {
        baseUrl: '',
        model: '',
        requiresApiKey: true
    }
};

export { PROVIDER_DEFAULTS };

export interface LLMClientConfig {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    timeout?: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ChatResponse {
    content: string | null;
    toolCalls?: ToolCall[];
    finishReason: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export class LLMClient {
    private client: OpenAI | null = null;
    private config: LLMClientConfig | null = null;

    constructor() {
        this.loadConfigFromSettings();
    }

    /**
     * Load configuration from VSCode settings
     */
    public loadConfigFromSettings(): void {
        const settings = vscode.workspace.getConfiguration('traycer');
        const provider = settings.get<string>('provider') || 'openai';
        const providerDefaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
        
        const apiKey = settings.get<string>('apiKey') || '';
        const baseUrl = settings.get<string>('apiBaseUrl') || providerDefaults.baseUrl;
        const model = settings.get<string>('model') || providerDefaults.model;

        this.configure({
            provider,
            apiKey,
            baseUrl,
            model
        });
    }

    /**
     * Configure the LLM client with new settings
     */
    public configure(config: LLMClientConfig): void {
        this.config = config;
        
        const providerDefaults = PROVIDER_DEFAULTS[config.provider] || PROVIDER_DEFAULTS.openai;
        const needsApiKey = providerDefaults.requiresApiKey;
        
        // For providers that don't need API key (like Ollama), use a placeholder
        const apiKey = needsApiKey ? config.apiKey : (config.apiKey || 'ollama');
        
        if (apiKey || !needsApiKey) {
            this.client = new OpenAI({
                apiKey: apiKey,
                baseURL: config.baseUrl || providerDefaults.baseUrl,
                timeout: config.timeout || 60000
            });
        } else {
            this.client = null;
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): LLMClientConfig | null {
        return this.config;
    }

    /**
     * Validate current configuration
     */
    public validateConfig(): ValidationResult {
        const errors: string[] = [];

        if (!this.config) {
            errors.push('Configuration not set');
            return { valid: false, errors };
        }

        const providerDefaults = PROVIDER_DEFAULTS[this.config.provider] || PROVIDER_DEFAULTS.openai;

        if (providerDefaults.requiresApiKey && (!this.config.apiKey || this.config.apiKey.trim() === '')) {
            errors.push('API Key is required. Please configure it in Traycer Settings.');
        }

        if (!this.config.baseUrl || this.config.baseUrl.trim() === '') {
            errors.push('API Base URL is required.');
        }

        if (!this.config.model || this.config.model.trim() === '') {
            errors.push('Model name is required.');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Send chat messages to the LLM
     */
    public async chat(
        messages: ChatMessage[],
        tools?: ToolDefinition[]
    ): Promise<ChatResponse> {
        const validation = this.validateConfig();
        if (!validation.valid) {
            throw new Error(validation.errors.join('\n'));
        }

        if (!this.client) {
            throw new Error('LLM client not initialized. Please configure API key.');
        }

        try {
            const response = await this.client.chat.completions.create({
                model: this.config!.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                tools: tools?.map(t => ({
                    type: 'function' as const,
                    function: t.function
                }))
            });

            const choice = response.choices[0];
            const message = choice.message;

            return {
                content: message.content,
                toolCalls: message.tool_calls?.map(tc => {
                    if (tc.type === 'function') {
                        return {
                            id: tc.id,
                            type: 'function' as const,
                            function: {
                                name: (tc as any).function.name,
                                arguments: (tc as any).function.arguments
                            }
                        };
                    }
                    return {
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: '', arguments: '' }
                    };
                }),
                finishReason: choice.finish_reason || 'stop'
            };
        } catch (error: any) {
            throw this.handleApiError(error);
        }
    }

    /**
     * Stream chat responses from the LLM
     */
    public async *chatStream(
        messages: ChatMessage[],
        tools?: ToolDefinition[]
    ): AsyncIterable<{ content?: string; toolCalls?: ToolCall[]; done: boolean }> {
        const validation = this.validateConfig();
        if (!validation.valid) {
            throw new Error(validation.errors.join('\n'));
        }

        if (!this.client) {
            throw new Error('LLM client not initialized. Please configure API key.');
        }

        try {
            const stream = await this.client.chat.completions.create({
                model: this.config!.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                tools: tools?.map(t => ({
                    type: 'function' as const,
                    function: t.function
                })),
                stream: true
            });

            let accumulatedToolCalls: Map<number, ToolCall> = new Map();

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                
                if (delta?.content) {
                    yield { content: delta.content, done: false };
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const existing = accumulatedToolCalls.get(tc.index) || {
                            id: '',
                            type: 'function' as const,
                            function: { name: '', arguments: '' }
                        };

                        if (tc.id) existing.id = tc.id;
                        if ('function' in tc && tc.function?.name) existing.function.name = tc.function.name;
                        if ('function' in tc && tc.function?.arguments) existing.function.arguments += tc.function.arguments;

                        accumulatedToolCalls.set(tc.index, existing);
                    }
                }

                if (chunk.choices[0]?.finish_reason) {
                    const toolCalls = accumulatedToolCalls.size > 0 
                        ? Array.from(accumulatedToolCalls.values())
                        : undefined;
                    yield { toolCalls, done: true };
                }
            }
        } catch (error: any) {
            throw this.handleApiError(error);
        }
    }

    /**
     * Handle API errors and convert to user-friendly messages
     */
    private handleApiError(error: any): Error {
        console.error('LLM API Error:', error);

        if (error.status === 401) {
            return new Error('Authentication failed. Please check your API key.');
        }

        if (error.status === 429) {
            return new Error('Rate limit exceeded. Please wait a moment and try again.');
        }

        if (error.status === 500 || error.status === 502 || error.status === 503) {
            return new Error('API service is temporarily unavailable. Please try again later.');
        }

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return new Error('Network error. Please check your internet connection and API base URL.');
        }

        if (error.code === 'ETIMEDOUT') {
            return new Error('Request timed out. Please try again.');
        }

        return new Error(`API Error: ${error.message || 'Unknown error occurred'}`);
    }
}
