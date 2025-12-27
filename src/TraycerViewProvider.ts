import * as vscode from 'vscode';
import { PhaseRunner } from './core/phases/PhaseRunner';
import { PhaseContext } from './core/types';

export class TraycerViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'traycer.chatView';

	private _view?: vscode.WebviewView;
	private _isProcessing = false;

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
					await this._handleSendMessage(data.value);
					break;
				case 'clearHistory':
					this._phaseRunner.clearHistory();
					this._view?.webview.postMessage({ type: 'historyCleared' });
					break;
				case 'executeAction':
					vscode.window.showInformationMessage(`Executing action: ${data.action}`);
					break;
			}
		});
	}

	private async _handleSendMessage(userMessage: string) {
		if (this._isProcessing) {
			return;
		}

		this._isProcessing = true;
		this._view?.webview.postMessage({ type: 'setLoading', value: true });

		try {
			const phaseContext: PhaseContext = {
				workspaceRoot: vscode.workspace.workspaceFolders?.[0].uri.fsPath || '',
				mcpContext: {},
				history: this._phaseRunner.getHistory()
			};

			// Determine phase based on intent
			const phase = this._determinePhase(userMessage);

			// Use streaming for real-time feedback
			let fullResponse = '';
			await this._phaseRunner.executePhaseStream(phase, phaseContext, (chunk) => {
				fullResponse += chunk;
				this._view?.webview.postMessage({
					type: 'streamChunk',
					value: chunk
				});
			});

			this._view?.webview.postMessage({
				type: 'streamComplete',
				value: fullResponse,
				phase: phase
			});
		} catch (err: any) {
			this._view?.webview.postMessage({
				type: 'error',
				value: err.message
			});
		} finally {
			this._isProcessing = false;
			this._view?.webview.postMessage({ type: 'setLoading', value: false });
		}
	}

	private _determinePhase(message: string): 'plan' | 'review' | 'phases' {
		const lowerMessage = message.toLowerCase();

		if (lowerMessage === 'plan' || lowerMessage === 'review' || lowerMessage === 'phases') {
			return lowerMessage as 'plan' | 'review' | 'phases';
		}

		if (lowerMessage.includes('review')) {
			return 'review';
		} else if (lowerMessage.includes('phase')) {
			return 'phases';
		}
		return 'plan';
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
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
			--code-bg: rgba(0, 0, 0, 0.3);
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

		#header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 8px 12px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		}

		#header-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--vscode-editor-foreground);
		}

		#header-actions {
			display: flex;
			gap: 4px;
		}

		.header-btn {
			background: transparent;
			border: none;
			color: var(--vscode-editor-foreground);
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 11px;
			cursor: pointer;
			opacity: 0.7;
			transition: all 0.2s;
		}

		.header-btn:hover {
			opacity: 1;
			background: rgba(255, 255, 255, 0.1);
		}

		#mode-selector {
			display: flex;
			padding: 8px 12px;
			gap: 8px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		}

		.mode-btn {
			flex: 1;
			background: rgba(255, 255, 255, 0.05);
			border: 1px solid rgba(255, 255, 255, 0.1);
			color: var(--vscode-editor-foreground);
			padding: 8px 12px;
			border-radius: 6px;
			font-size: 12px;
			cursor: pointer;
			transition: all 0.2s;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 4px;
		}

		.mode-btn:hover {
			background: rgba(99, 102, 241, 0.2);
			border-color: #6366f1;
		}

		.mode-btn.active {
			background: rgba(99, 102, 241, 0.3);
			border-color: #6366f1;
		}

		.mode-icon {
			font-size: 16px;
		}

		.mode-label {
			font-weight: 500;
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
			max-width: 90%;
			padding: 10px 14px;
			border-radius: 12px;
			font-size: 13px;
			line-height: 1.6;
			animation: fadeIn 0.2s ease-out;
			word-wrap: break-word;
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

		.error-message {
			align-self: flex-start;
			background-color: rgba(239, 68, 68, 0.1);
			border: 1px solid rgba(239, 68, 68, 0.3);
			color: #ef4444;
		}

		.loading-message {
			align-self: flex-start;
			background-color: var(--bubble-ai);
			border: 1px solid rgba(99, 102, 241, 0.2);
		}

		.loading-dots {
			display: inline-flex;
			gap: 4px;
		}

		.loading-dots span {
			width: 6px;
			height: 6px;
			background: #6366f1;
			border-radius: 50%;
			animation: bounce 1.4s infinite ease-in-out both;
		}

		.loading-dots span:nth-child(1) { animation-delay: -0.32s; }
		.loading-dots span:nth-child(2) { animation-delay: -0.16s; }

		@keyframes bounce {
			0%, 80%, 100% { transform: scale(0); }
			40% { transform: scale(1); }
		}

		/* Markdown styles */
		.ai-message code {
			background: var(--code-bg);
			padding: 2px 6px;
			border-radius: 4px;
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 12px;
		}

		.ai-message pre {
			background: var(--code-bg);
			padding: 12px;
			border-radius: 6px;
			overflow-x: auto;
			margin: 8px 0;
		}

		.ai-message pre code {
			background: transparent;
			padding: 0;
		}

		.ai-message ul, .ai-message ol {
			margin: 8px 0;
			padding-left: 20px;
		}

		.ai-message li {
			margin: 4px 0;
		}

		.ai-message a {
			color: #6366f1;
			text-decoration: none;
		}

		.ai-message a:hover {
			text-decoration: underline;
		}

		.ai-message strong {
			font-weight: 600;
		}

		.ai-message h1, .ai-message h2, .ai-message h3 {
			margin: 12px 0 8px 0;
			font-weight: 600;
		}

		.ai-message h1 { font-size: 16px; }
		.ai-message h2 { font-size: 14px; }
		.ai-message h3 { font-size: 13px; }

		#input-area {
			padding: 12px 16px;
			border-top: 1px solid rgba(255, 255, 255, 0.05);
		}

		.input-wrapper {
			display: flex;
			align-items: flex-end;
			background: rgba(255, 255, 255, 0.03);
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			padding: 4px 8px;
		}

		textarea {
			flex-grow: 1;
			background: transparent;
			border: none;
			color: var(--vscode-editor-foreground);
			padding: 8px;
			resize: none;
			outline: none;
			font-size: 13px;
			font-family: inherit;
			max-height: 120px;
		}

		#send-button {
			background: var(--gradient-accent);
			color: white;
			border: none;
			border-radius: 6px;
			width: 32px;
			height: 32px;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: opacity 0.2s;
		}

		#send-button:hover {
			opacity: 0.9;
		}

		#send-button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		#send-button svg {
			width: 16px;
			height: 16px;
		}
	</style>
</head>
<body>
	<div id="chat-container">
		<div id="header">
			<span id="header-title">Traycer AI</span>
			<div id="header-actions">
				<button class="header-btn" onclick="clearChat()" title="Clear chat">🗑️</button>
			</div>
		</div>
		<div id="mode-selector">
			<button class="mode-btn" onclick="triggerPhase('phases')" title="Clarify intent and break down tasks">
				<span class="mode-icon">📋</span>
				<span class="mode-label">Phases</span>
			</button>
			<button class="mode-btn" onclick="triggerPhase('plan')" title="Create implementation plan">
				<span class="mode-icon">📝</span>
				<span class="mode-label">Plan</span>
			</button>
			<button class="mode-btn" onclick="triggerPhase('review')" title="Review code quality">
				<span class="mode-icon">🔍</span>
				<span class="mode-label">Review</span>
			</button>
		</div>
		<div id="messages">
			<div class="message ai-message">
				👋 Welcome! I'm your AI assistant. Choose a mode above or describe your task below.
			</div>
		</div>
		<div id="input-area">
			<div class="input-wrapper">
				<textarea id="message-input" rows="1" placeholder="Describe your task (@mention for context)..."></textarea>
				<button id="send-button" title="Send (Enter)">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
					</svg>
				</button>
			</div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		const messageInput = document.getElementById('message-input');
		const sendButton = document.getElementById('send-button');
		const messagesContainer = document.getElementById('messages');
		let currentStreamingMessage = null;
		let isLoading = false;

		function triggerPhase(phase) {
			if (isLoading) return;
			addMessage('Starting ' + phase + ' mode...', 'user');
			vscode.postMessage({ type: 'sendMessage', value: phase });
		}

		function clearChat() {
			messagesContainer.innerHTML = '<div class="message ai-message">👋 Chat cleared. Ready for a new conversation!</div>';
			vscode.postMessage({ type: 'clearHistory' });
		}

		sendButton.addEventListener('click', () => {
			if (isLoading) return;
			const message = messageInput.value.trim();
			if (message) {
				addMessage(message, 'user');
				vscode.postMessage({ type: 'sendMessage', value: message });
				messageInput.value = '';
				autoResizeTextarea();
			}
		});

		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendButton.click();
			}
		});

		messageInput.addEventListener('input', autoResizeTextarea);

		function autoResizeTextarea() {
			messageInput.style.height = 'auto';
			messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
		}

		function addMessage(text, sender) {
			const div = document.createElement('div');
			div.className = 'message ' + (sender === 'user' ? 'user-message' : 'ai-message');
			
			if (sender === 'ai') {
				div.innerHTML = renderMarkdown(text);
			} else {
				div.textContent = text;
			}
			
			messagesContainer.appendChild(div);
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
			return div;
		}

		function addLoadingMessage() {
			const div = document.createElement('div');
			div.className = 'message loading-message';
			div.id = 'loading-message';
			div.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
			messagesContainer.appendChild(div);
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}

		function removeLoadingMessage() {
			const loading = document.getElementById('loading-message');
			if (loading) loading.remove();
		}

		function renderMarkdown(text) {
			// Simple markdown rendering
			let html = text
				// Code blocks
				.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
				// Inline code
				.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
				// Bold
				.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
				// Italic
				.replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
				// Headers
				.replace(/^### (.+)$/gm, '<h3>$1</h3>')
				.replace(/^## (.+)$/gm, '<h2>$1</h2>')
				.replace(/^# (.+)$/gm, '<h1>$1</h1>')
				// Links
				.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
				// Line breaks
				.replace(/\\n/g, '<br>');
			
			return html;
		}

		function setLoading(loading) {
			isLoading = loading;
			sendButton.disabled = loading;
			if (loading) {
				addLoadingMessage();
			} else {
				removeLoadingMessage();
			}
		}

		window.addEventListener('message', event => {
			const message = event.data;
			switch (message.type) {
				case 'setLoading':
					setLoading(message.value);
					break;
				case 'streamChunk':
					if (!currentStreamingMessage) {
						removeLoadingMessage();
						currentStreamingMessage = addMessage('', 'ai');
					}
					currentStreamingMessage.innerHTML = renderMarkdown(
						currentStreamingMessage.textContent + message.value
					);
					currentStreamingMessage.textContent += message.value;
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
					break;
				case 'streamComplete':
					if (currentStreamingMessage) {
						currentStreamingMessage.innerHTML = renderMarkdown(message.value);
					}
					currentStreamingMessage = null;
					break;
				case 'addResponse':
					addMessage(message.value, 'ai');
					break;
				case 'error':
					removeLoadingMessage();
					const errorDiv = document.createElement('div');
					errorDiv.className = 'message error-message';
					errorDiv.textContent = '❌ ' + message.value;
					messagesContainer.appendChild(errorDiv);
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
					currentStreamingMessage = null;
					break;
				case 'historyCleared':
					// Already handled in clearChat
					break;
			}
		});
	</script>
</body>
</html>`;
	}
}
