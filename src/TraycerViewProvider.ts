import * as vscode from 'vscode';
import { PhaseRunner } from './core/phases/PhaseRunner';
import { PhaseContext } from './core/types';

export class TraycerViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'traycer.chatView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _phaseRunner: PhaseRunner
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'sendMessage':
					{
						const userMessage = data.value;
						// Construct Context
						const phaseContext: PhaseContext = {
							workspaceRoot: vscode.workspace.workspaceFolders?.[0].uri.fsPath || '',
							mcpContext: {},
							history: this._phaseRunner.getHistory()
						};

						// Determine phase based on intent
						let phase: 'plan' | 'review' | 'phases';
						const lowerMessage = userMessage.toLowerCase();

						if (lowerMessage === 'plan' || lowerMessage === 'review' || lowerMessage === 'phases') {
							phase = lowerMessage as 'plan' | 'review' | 'phases';
						} else {
							// Fallback to keyword inference
							if (lowerMessage.includes('review')) {
								phase = 'review';
							} else if (lowerMessage.includes('phase')) {
								phase = 'phases';
							} else {
								phase = 'plan';
							}
						}

						const result = await this._phaseRunner.executePhase(phase, phaseContext);

						this._view?.webview.postMessage({
							type: 'addResponse',
							value: result.output,
							phase: result.phase
						});
						break;
					}
				case 'executeAction':
					{
						vscode.window.showInformationMessage(`Executing action: ${data.action}`);
						break;
					}
			}
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Reuse the premium UI style from before but with button for Phases/Review
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Traycer Chat</title>
				<style>
					:root {
						--accent-color: #007acc;
						--gradient-accent: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
						--bubble-ai: rgba(99, 102, 241, 0.1);
					}

					body {
						font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
						padding: 0;
						margin: 0;
						color: var(--vscode-editor-foreground);
						background-color: var(--vscode-sideBar-background);
						height: 100vh;
						display: flex;
						flex-direction: column;
					}

					#chat-container {
						display: flex;
						flex-direction: column;
						height: 100vh;
					}

					#header-actions {
						display: flex;
						padding: 10px;
						gap: 8px;
						border-bottom: 1px solid rgba(255, 255, 255, 0.05);
					}

					.action-btn {
						flex: 1;
						background: rgba(255, 255, 255, 0.05);
						border: 1px solid rgba(255, 255, 255, 0.1);
						color: var(--vscode-editor-foreground);
						padding: 6px;
						border-radius: 4px;
						font-size: 11px;
						cursor: pointer;
						transition: all 0.2s;
					}

					.action-btn:hover {
						background: rgba(99, 102, 241, 0.2);
						border-color: #6366f1;
					}

					#messages {
						flex-grow: 1;
						overflow-y: auto;
						padding: 16px;
						display: flex;
						flex-direction: column;
						gap: 12px;
					}

					.message {
						max-width: 85%;
						padding: 10px 14px;
						border-radius: 12px;
						font-size: 13px;
						line-height: 1.5;
						animation: fadeIn 0.2s ease-out;
					}

					@keyframes fadeIn {
						from { opacity: 0; transform: translateY(5px); }
						to { opacity: 1; transform: translateY(0); }
					}

					.user-message {
						align-self: flex-end;
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border-bottom-right-radius: 2px;
					}

					.ai-message {
						align-self: flex-start;
						background-color: var(--bubble-ai);
						border: 1px solid rgba(99, 102, 241, 0.2);
						border-bottom-left-radius: 2px;
					}

					#input-area {
						padding: 16px;
						border-top: 1px solid rgba(255, 255, 255, 0.05);
					}

					.input-wrapper {
						display: flex;
						align-items: center;
						background: rgba(255, 255, 255, 0.03);
						border: 1px solid rgba(255, 255, 255, 0.1);
						border-radius: 8px;
						padding: 4px 8px;
					}

					textarea {
						flex-grow: 1;
						background: transparent;
						border: none;
						color: white;
						padding: 8px;
						resize: none;
						outline: none;
						font-size: 13px;
					}

					#send-button {
						background: var(--gradient-accent);
						color: white;
						border: none;
						border-radius: 4px;
						width: 28px;
						height: 28px;
						cursor: pointer;
					}
				</style>
			</head>
			<body>
				<div id="chat-container">
					<div id="header-actions">
						<button class="action-btn" onclick="triggerPhase('plan')">Plan</button>
						<button class="action-btn" onclick="triggerPhase('review')">Review</button>
						<button class="action-btn" onclick="triggerPhase('phases')">Phases</button>
					</div>
					<div id="messages">
                        <div class="message ai-message">
                            Professional Mode Active. I'm ready to plan or review your codebase.
                        </div>
                    </div>
					<div id="input-area">
						<div class="input-wrapper">
							<textarea id="message-input" rows="1" placeholder="Describe your task..."></textarea>
							<button id="send-button">-></button>
						</div>
					</div>
				</div>

				<script>
					const vscode = acquireVsCodeApi();
					const messageInput = document.getElementById('message-input');
					const sendButton = document.getElementById('send-button');
					const messagesContainer = document.getElementById('messages');

					function triggerPhase(phase) {
						addMessage('Executing ' + phase + '...', 'user');
						vscode.postMessage({ type: 'sendMessage', value: phase });
					}

					sendButton.addEventListener('click', () => {
						const message = messageInput.value.trim();
						if (message) {
							addMessage(message, 'user');
							vscode.postMessage({ type: 'sendMessage', value: message });
							messageInput.value = '';
						}
					});

					messageInput.addEventListener('keydown', (e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendButton.click();
						}
					});

					function addMessage(text, sender) {
						const div = document.createElement('div');
						div.className = 'message ' + (sender === 'user' ? 'user-message' : 'ai-message');
						div.textContent = text;
						messagesContainer.appendChild(div);
						messagesContainer.scrollTop = messagesContainer.scrollHeight;
					}

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'addResponse') {
                            addMessage(message.value, 'ai');
                        }
                    });
				</script>
			</body>
			</html>`;
	}
}
