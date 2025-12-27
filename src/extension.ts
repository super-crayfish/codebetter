import * as vscode from 'vscode';
import { PhaseRunner } from './core/phases/PhaseRunner';
import { TraycerViewProvider } from './TraycerViewProvider';
import { SettingsViewProvider } from './SettingsViewProvider';
import { ConfigurationManager } from './core/llm/ConfigurationManager';
import { LLMClient } from './core/llm/LLMClient';
import { McpRegistry } from './core/mcp/McpRegistry';

export function activate(context: vscode.ExtensionContext) {
    console.log('Traycer Clone is now active!');

    // Initialize shared LLM Client
    const llmClient = new LLMClient();
    
    // Initialize MCP Registry and load user-configured servers
    const mcpRegistry = new McpRegistry();
    loadUserMcpServers(mcpRegistry);
    
    // Initialize Configuration Manager with shared LLM Client
    const configManager = new ConfigurationManager(llmClient);

    // Assemble Core Services with shared instances
    const phaseRunner = new PhaseRunner(llmClient, mcpRegistry);

    // Assemble View Providers
    const chatProvider = new TraycerViewProvider(context.extensionUri, phaseRunner);
    const settingsProvider = new SettingsViewProvider(context.extensionUri, mcpRegistry);

    // Register Webview Providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TraycerViewProvider.viewType, chatProvider)
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsProvider)
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('traycer.startPlan', () => {
            vscode.commands.executeCommand('workbench.view.extension.traycer-explorer');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('traycer.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'traycer');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('traycer.configureMcp', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'traycer.mcpServers');
        })
    );

    // Listen for configuration changes to reload MCP servers
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('traycer.mcpServers')) {
                console.log('MCP servers configuration changed, reloading...');
                loadUserMcpServers(mcpRegistry);
            }
        })
    );

    // Add configuration manager to subscriptions for cleanup
    context.subscriptions.push({
        dispose: () => configManager.dispose()
    });

    // Check if API key is configured on startup
    const config = vscode.workspace.getConfiguration('traycer');
    const provider = config.get<string>('provider') || 'openai';
    const apiKey = config.get<string>('apiKey');
    
    // Only show warning for providers that require API key
    const requiresApiKey = ['openai', 'groq', 'custom'].includes(provider);
    if (requiresApiKey && !apiKey) {
        vscode.window.showWarningMessage(
            'Traycer: API Key not configured. Please configure your LLM provider settings.',
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.view.extension.traycer-explorer');
            }
        });
    }
}

/**
 * Load user-configured MCP servers from settings
 */
function loadUserMcpServers(mcpRegistry: McpRegistry): void {
    const config = vscode.workspace.getConfiguration('traycer');
    const mcpServers = config.get<Record<string, any>>('mcpServers') || {};
    
    // Clear existing user MCP servers and reload
    mcpRegistry.clearUserProviders();
    
    for (const [name, serverConfig] of Object.entries(mcpServers)) {
        if (serverConfig.disabled) {
            continue;
        }
        
        if (serverConfig.command) {
            mcpRegistry.registerUserMcpServer(name, serverConfig);
            console.log(`Registered user MCP server: ${name}`);
        }
    }
}

export function deactivate() {}
