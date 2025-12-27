import * as vscode from 'vscode';
import { PhaseRunner } from './core/phases/PhaseRunner';
import { TraycerViewProvider } from './TraycerViewProvider';
import { SettingsViewProvider } from './SettingsViewProvider';
import { ConfigurationManager } from './core/llm/ConfigurationManager';
import { LLMClient } from './core/llm/LLMClient';

export function activate(context: vscode.ExtensionContext) {
    console.log('Traycer Clone is now active!');

    // Initialize LLM Client and Configuration Manager
    const llmClient = new LLMClient();
    const configManager = new ConfigurationManager(llmClient);

    // Assemble Core Services
    const phaseRunner = new PhaseRunner();

    // Assemble View Providers
    const chatProvider = new TraycerViewProvider(context.extensionUri, phaseRunner);
    const settingsProvider = new SettingsViewProvider(context.extensionUri);

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

    // Add configuration manager to subscriptions for cleanup
    context.subscriptions.push({
        dispose: () => configManager.dispose()
    });

    // Check if API key is configured on startup
    const config = vscode.workspace.getConfiguration('traycer');
    const provider = config.get<string>('provider') || 'openai';
    const apiKey = config.get<string>('apiKey');
    
    // Only show warning for providers that require API key
    const requiresApiKey = ['openai', 'anthropic', 'groq', 'custom'].includes(provider);
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

export function deactivate() {}
