import * as vscode from 'vscode';

export interface ProviderConfig {
    name: string;
    defaultBaseUrl: string;
    defaultModel: string;
    models: string[];
    requiresApiKey: boolean;
}

export const LLM_PROVIDERS: Record<string, ProviderConfig> = {
    openai: {
        name: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
        requiresApiKey: true
    },
    anthropic: {
        name: 'Anthropic',
        defaultBaseUrl: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-3-5-sonnet-20241022',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
        requiresApiKey: true
    },
    groq: {
        name: 'Groq',
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.3-70b-versatile',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        requiresApiKey: true
    },
    ollama: {
        name: 'Ollama',
        defaultBaseUrl: 'http://localhost:11434/v1',
        defaultModel: 'llama3.2',
        models: ['llama3.2', 'codellama', 'mistral', 'qwen2.5-coder'],
        requiresApiKey: false
    },
    custom: {
        name: 'Custom',
        defaultBaseUrl: '',
        defaultModel: '',
        models: [],
        requiresApiKey: true
    }
};

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'traycer.settingsView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // Send current config to webview
        this._sendCurrentConfig();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveConfig':
                    await this._saveConfig(data.config);
                    break;
                case 'getConfig':
                    this._sendCurrentConfig();
                    break;
                case 'testConnection':
                    await this._testConnection();
                    break;
                case 'openVSCodeSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'traycer');
                    break;
            }
        });
    }

    private _sendCurrentConfig() {
        const config = vscode.workspace.getConfiguration('traycer');
        this._view?.webview.postMessage({
            type: 'configLoaded',
            config: {
                provider: config.get('provider') || 'openai',
                apiKey: config.get('apiKey') || '',
                apiBaseUrl: config.get('apiBaseUrl') || '',
                model: config.get('model') || '',
                mcpServers: config.get('mcpServers') || {}
            },
            providers: LLM_PROVIDERS
        });
    }

    private async _saveConfig(newConfig: any) {
        const config = vscode.workspace.getConfiguration('traycer');
        
        try {
            await config.update('provider', newConfig.provider, vscode.ConfigurationTarget.Global);
            await config.update('apiKey', newConfig.apiKey, vscode.ConfigurationTarget.Global);
            await config.update('apiBaseUrl', newConfig.apiBaseUrl, vscode.ConfigurationTarget.Global);
            await config.update('model', newConfig.model, vscode.ConfigurationTarget.Global);
            
            if (newConfig.mcpServers) {
                await config.update('mcpServers', newConfig.mcpServers, vscode.ConfigurationTarget.Global);
            }

            vscode.window.showInformationMessage('Traycer settings saved successfully!');
            this._view?.webview.postMessage({ type: 'saveSuccess' });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to save settings: ${err.message}`);
            this._view?.webview.postMessage({ type: 'saveError', error: err.message });
        }
    }

    private async _testConnection() {
        const config = vscode.workspace.getConfiguration('traycer');
        const provider = config.get<string>('provider') || 'openai';
        const apiKey = config.get<string>('apiKey') || '';
        const providerConfig = LLM_PROVIDERS[provider];

        if (providerConfig.requiresApiKey && !apiKey) {
            this._view?.webview.postMessage({ 
                type: 'testResult', 
                success: false, 
                message: 'API Key is required' 
            });
            return;
        }

        this._view?.webview.postMessage({ type: 'testStarted' });

        try {
            const baseUrl = config.get<string>('apiBaseUrl') || providerConfig.defaultBaseUrl;
            const model = config.get<string>('model') || providerConfig.defaultModel;

            const OpenAI = require('openai');
            const client = new OpenAI({
                apiKey: apiKey || 'ollama',
                baseURL: baseUrl,
                timeout: 10000
            });

            await client.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5
            });

            this._view?.webview.postMessage({ 
                type: 'testResult', 
                success: true, 
                message: 'Connection successful!' 
            });
        } catch (err: any) {
            this._view?.webview.postMessage({ 
                type: 'testResult', 
                success: false, 
                message: err.message 
            });
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Traycer Settings</title>
    <style>
        :root {
            --accent: #6366f1;
            --success: #22c55e;
            --error: #ef4444;
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 16px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-sideBar-background);
        }
        h2 {
            font-size: 14px;
            margin: 0 0 16px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        h3 {
            font-size: 12px;
            margin: 16px 0 8px 0;
            color: var(--vscode-descriptionForeground);
        }
        .form-group {
            margin-bottom: 12px;
        }
        label {
            display: block;
            font-size: 12px;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
        }
        select, input[type="text"], input[type="password"] {
            width: 100%;
            padding: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            background: rgba(255,255,255,0.05);
            color: var(--vscode-editor-foreground);
            font-size: 13px;
            box-sizing: border-box;
        }
        select:focus, input:focus {
            outline: none;
            border-color: var(--accent);
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: opacity 0.2s;
        }
        .btn:hover { opacity: 0.9; }
        .btn-primary {
            background: var(--accent);
            color: white;
        }
        .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: var(--vscode-editor-foreground);
        }
        .btn-group {
            display: flex;
            gap: 8px;
            margin-top: 16px;
        }
        .status {
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-top: 8px;
        }
        .status.success {
            background: rgba(34, 197, 94, 0.1);
            color: var(--success);
        }
        .status.error {
            background: rgba(239, 68, 68, 0.1);
            color: var(--error);
        }
        .status.loading {
            background: rgba(99, 102, 241, 0.1);
            color: var(--accent);
        }
        .section {
            margin-bottom: 24px;
        }
        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .mcp-server {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 8px;
        }
        .mcp-server-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .mcp-server-name {
            font-weight: 500;
        }
        .remove-btn {
            background: transparent;
            border: none;
            color: var(--error);
            cursor: pointer;
            font-size: 14px;
        }
        .add-server-btn {
            width: 100%;
            padding: 8px;
            border: 1px dashed rgba(255,255,255,0.2);
            border-radius: 4px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 12px;
        }
        .add-server-btn:hover {
            border-color: var(--accent);
            color: var(--accent);
        }
    </style>
</head>
<body>
    <div class="section">
        <h2>⚙️ LLM Provider Settings</h2>
        
        <div class="form-group">
            <label>Provider</label>
            <select id="provider">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="groq">Groq</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="custom">Custom API</option>
            </select>
        </div>

        <div class="form-group" id="apiKeyGroup">
            <label>API Key</label>
            <input type="password" id="apiKey" placeholder="Enter your API key">
            <div class="hint">Your API key is stored securely in VS Code settings</div>
        </div>

        <div class="form-group">
            <label>API Base URL (optional)</label>
            <input type="text" id="apiBaseUrl" placeholder="Leave empty for default">
            <div class="hint" id="baseUrlHint">Default: https://api.openai.com/v1</div>
        </div>

        <div class="form-group">
            <label>Model</label>
            <select id="model"></select>
            <input type="text" id="customModel" placeholder="Or enter custom model name" style="margin-top: 4px;">
        </div>

        <div class="btn-group">
            <button class="btn btn-secondary" onclick="testConnection()">Test Connection</button>
            <button class="btn btn-primary" onclick="saveConfig()">Save Settings</button>
        </div>

        <div id="status" class="status" style="display: none;"></div>
    </div>

    <div class="section">
        <h2>🔌 MCP Servers</h2>
        <div class="hint" style="margin-bottom: 12px;">
            Configure external MCP servers for additional tools and capabilities
        </div>
        
        <div id="mcpServers"></div>
        
        <button class="add-server-btn" onclick="addMcpServer()">+ Add MCP Server</button>
    </div>

    <div class="section">
        <button class="btn btn-secondary" onclick="openVSCodeSettings()" style="width: 100%;">
            Open VS Code Settings
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};
        let providers = {};

        // Request config on load
        vscode.postMessage({ type: 'getConfig' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'configLoaded':
                    currentConfig = message.config;
                    providers = message.providers;
                    updateUI();
                    break;
                case 'testStarted':
                    showStatus('Testing connection...', 'loading');
                    break;
                case 'testResult':
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                case 'saveSuccess':
                    showStatus('Settings saved!', 'success');
                    break;
                case 'saveError':
                    showStatus('Failed to save: ' + message.error, 'error');
                    break;
            }
        });

        function updateUI() {
            const providerSelect = document.getElementById('provider');
            const apiKeyInput = document.getElementById('apiKey');
            const apiBaseUrlInput = document.getElementById('apiBaseUrl');
            const modelSelect = document.getElementById('model');
            const customModelInput = document.getElementById('customModel');
            const apiKeyGroup = document.getElementById('apiKeyGroup');
            const baseUrlHint = document.getElementById('baseUrlHint');

            providerSelect.value = currentConfig.provider || 'openai';
            apiKeyInput.value = currentConfig.apiKey || '';
            apiBaseUrlInput.value = currentConfig.apiBaseUrl || '';
            customModelInput.value = currentConfig.model || '';

            updateProviderUI();
            renderMcpServers();
        }

        function updateProviderUI() {
            const provider = document.getElementById('provider').value;
            const providerConfig = providers[provider];
            const apiKeyGroup = document.getElementById('apiKeyGroup');
            const baseUrlHint = document.getElementById('baseUrlHint');
            const modelSelect = document.getElementById('model');

            // Show/hide API key based on provider
            apiKeyGroup.style.display = providerConfig.requiresApiKey ? 'block' : 'none';
            
            // Update base URL hint
            baseUrlHint.textContent = 'Default: ' + (providerConfig.defaultBaseUrl || 'None');

            // Update model options
            modelSelect.innerHTML = '';
            if (providerConfig.models.length > 0) {
                providerConfig.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });
                modelSelect.value = currentConfig.model || providerConfig.defaultModel;
            }
        }

        document.getElementById('provider').addEventListener('change', updateProviderUI);

        function saveConfig() {
            const provider = document.getElementById('provider').value;
            const apiKey = document.getElementById('apiKey').value;
            const apiBaseUrl = document.getElementById('apiBaseUrl').value;
            const modelSelect = document.getElementById('model').value;
            const customModel = document.getElementById('customModel').value;

            vscode.postMessage({
                type: 'saveConfig',
                config: {
                    provider,
                    apiKey,
                    apiBaseUrl,
                    model: customModel || modelSelect,
                    mcpServers: collectMcpServers()
                }
            });
        }

        function testConnection() {
            saveConfig();
            setTimeout(() => {
                vscode.postMessage({ type: 'testConnection' });
            }, 500);
        }

        function showStatus(message, type) {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = 'status ' + type;
            status.style.display = 'block';
            
            if (type !== 'loading') {
                setTimeout(() => {
                    status.style.display = 'none';
                }, 5000);
            }
        }

        function openVSCodeSettings() {
            vscode.postMessage({ type: 'openVSCodeSettings' });
        }

        // MCP Server Management
        function renderMcpServers() {
            const container = document.getElementById('mcpServers');
            const servers = currentConfig.mcpServers || {};
            
            container.innerHTML = '';
            
            Object.entries(servers).forEach(([name, config]) => {
                container.innerHTML += createMcpServerHtml(name, config);
            });
        }

        function createMcpServerHtml(name, config) {
            return \`
                <div class="mcp-server" data-name="\${name}">
                    <div class="mcp-server-header">
                        <span class="mcp-server-name">\${name}</span>
                        <button class="remove-btn" onclick="removeMcpServer('\${name}')">✕</button>
                    </div>
                    <div class="form-group">
                        <label>Command</label>
                        <input type="text" class="mcp-command" value="\${config.command || ''}" placeholder="e.g., uvx">
                    </div>
                    <div class="form-group">
                        <label>Arguments (comma separated)</label>
                        <input type="text" class="mcp-args" value="\${(config.args || []).join(', ')}" placeholder="e.g., mcp-server-name">
                    </div>
                </div>
            \`;
        }

        function addMcpServer() {
            const name = prompt('Enter server name:');
            if (!name) return;
            
            if (!currentConfig.mcpServers) {
                currentConfig.mcpServers = {};
            }
            
            currentConfig.mcpServers[name] = {
                command: '',
                args: [],
                disabled: false
            };
            
            renderMcpServers();
        }

        function removeMcpServer(name) {
            if (confirm('Remove server "' + name + '"?')) {
                delete currentConfig.mcpServers[name];
                renderMcpServers();
            }
        }

        function collectMcpServers() {
            const servers = {};
            document.querySelectorAll('.mcp-server').forEach(el => {
                const name = el.dataset.name;
                const command = el.querySelector('.mcp-command').value;
                const argsStr = el.querySelector('.mcp-args').value;
                const args = argsStr ? argsStr.split(',').map(s => s.trim()).filter(s => s) : [];
                
                servers[name] = { command, args, disabled: false };
            });
            return servers;
        }
    </script>
</body>
</html>`;
    }
}
