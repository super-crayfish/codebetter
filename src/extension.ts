import * as vscode from 'vscode';
import { PhaseRunner } from './core/phases/PhaseRunner';
import { TraycerViewProvider } from './TraycerViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Traycer (Professional) is now active!');

    // Assemble Core Services
    const phaseRunner = new PhaseRunner();

    // Assemble View Provider (Inject Services)
    const provider = new TraycerViewProvider(context.extensionUri, phaseRunner);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TraycerViewProvider.viewType, provider)
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('traycer.startPlan', () => {
            vscode.commands.executeCommand('workbench.view.extension.traycer-explorer');
        })
    );
}

export function deactivate() { }
