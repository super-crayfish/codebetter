import * as vscode from 'vscode';
import { LLMClient, LLMClientConfig } from './LLMClient';

/**
 * Manages LLM configuration and handles dynamic updates
 */
export class ConfigurationManager {
    private llmClient: LLMClient;
    private disposables: vscode.Disposable[] = [];

    constructor(llmClient: LLMClient) {
        this.llmClient = llmClient;
        this.setupConfigurationListener();
    }

    /**
     * Setup listener for configuration changes
     */
    private setupConfigurationListener(): void {
        const disposable = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('traycer')) {
                console.log('Traycer configuration changed, reloading...');
                this.reloadConfiguration();
            }
        });
        this.disposables.push(disposable);
    }

    /**
     * Reload configuration from VSCode settings
     */
    public reloadConfiguration(): void {
        this.llmClient.loadConfigFromSettings();
        const validation = this.llmClient.validateConfig();
        
        if (!validation.valid) {
            vscode.window.showWarningMessage(
                `Traycer configuration issue: ${validation.errors.join(', ')}`
            );
        } else {
            console.log('Traycer configuration reloaded successfully');
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): LLMClientConfig | null {
        return this.llmClient.getConfig();
    }

    /**
     * Open settings UI for Traycer configuration
     */
    public async openSettings(): Promise<void> {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'traycer'
        );
    }

    /**
     * Prompt user to configure API key if not set
     */
    public async promptForApiKey(): Promise<boolean> {
        const config = this.llmClient.getConfig();
        
        if (config?.apiKey) {
            return true;
        }

        const action = await vscode.window.showWarningMessage(
            'Traycer: API Key not configured. Please set your API key to use AI features.',
            'Open Settings',
            'Cancel'
        );

        if (action === 'Open Settings') {
            await this.openSettings();
        }

        return false;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
