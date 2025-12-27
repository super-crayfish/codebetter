import * as vscode from 'vscode';

export enum ErrorType {
    API_ERROR = 'API_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    AUTH_ERROR = 'AUTH_ERROR',
    RATE_LIMIT = 'RATE_LIMIT',
    TIMEOUT = 'TIMEOUT',
    TOOL_ERROR = 'TOOL_ERROR',
    CONFIG_ERROR = 'CONFIG_ERROR',
    UNKNOWN = 'UNKNOWN'
}

export interface ErrorContext {
    type: ErrorType;
    message: string;
    originalError?: Error;
    details?: Record<string, unknown>;
    timestamp: number;
}

export class ErrorLogger {
    private static instance: ErrorLogger;
    private outputChannel: vscode.OutputChannel;
    private errorHistory: ErrorContext[] = [];
    private maxHistorySize = 100;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Traycer');
    }

    public static getInstance(): ErrorLogger {
        if (!ErrorLogger.instance) {
            ErrorLogger.instance = new ErrorLogger();
        }
        return ErrorLogger.instance;
    }

    /**
     * Log an error with context
     */
    public logError(
        type: ErrorType,
        message: string,
        originalError?: Error,
        details?: Record<string, unknown>
    ): void {
        const errorContext: ErrorContext = {
            type,
            message,
            originalError,
            details,
            timestamp: Date.now()
        };

        // Add to history
        this.errorHistory.push(errorContext);
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }

        // Log to output channel
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${type}] ${message}`);
        
        if (originalError?.stack) {
            this.outputChannel.appendLine(`Stack: ${originalError.stack}`);
        }
        
        if (details) {
            this.outputChannel.appendLine(`Details: ${JSON.stringify(details, null, 2)}`);
        }

        this.outputChannel.appendLine('---');

        // Also log to console for debugging
        console.error(`[Traycer] [${type}] ${message}`, { originalError, details });
    }

    /**
     * Get user-friendly error message
     */
    public getUserFriendlyMessage(type: ErrorType, originalMessage?: string): string {
        switch (type) {
            case ErrorType.API_ERROR:
                return 'An error occurred while communicating with the AI service. Please try again.';
            case ErrorType.NETWORK_ERROR:
                return 'Network connection failed. Please check your internet connection and try again.';
            case ErrorType.AUTH_ERROR:
                return 'Authentication failed. Please check your API key in settings.';
            case ErrorType.RATE_LIMIT:
                return 'Rate limit exceeded. Please wait a moment before trying again.';
            case ErrorType.TIMEOUT:
                return 'Request timed out. Please try again with a simpler request.';
            case ErrorType.TOOL_ERROR:
                return `Tool execution failed: ${originalMessage || 'Unknown error'}`;
            case ErrorType.CONFIG_ERROR:
                return 'Configuration error. Please check your settings.';
            default:
                return originalMessage || 'An unexpected error occurred. Please try again.';
        }
    }

    /**
     * Classify an error into ErrorType
     */
    public classifyError(error: any): ErrorType {
        if (!error) {
            return ErrorType.UNKNOWN;
        }

        // Check for HTTP status codes
        if (error.status === 401 || error.status === 403) {
            return ErrorType.AUTH_ERROR;
        }
        if (error.status === 429) {
            return ErrorType.RATE_LIMIT;
        }
        if (error.status >= 500) {
            return ErrorType.API_ERROR;
        }

        // Check for network errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
            return ErrorType.NETWORK_ERROR;
        }

        // Check for timeout
        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
            return ErrorType.TIMEOUT;
        }

        // Check for API errors
        if (error.status || error.response) {
            return ErrorType.API_ERROR;
        }

        return ErrorType.UNKNOWN;
    }

    /**
     * Show error to user with optional retry action
     */
    public async showError(
        type: ErrorType,
        message: string,
        showRetry: boolean = false
    ): Promise<'retry' | 'settings' | undefined> {
        const userMessage = this.getUserFriendlyMessage(type, message);
        
        const actions: string[] = [];
        if (showRetry) {
            actions.push('Retry');
        }
        if (type === ErrorType.AUTH_ERROR || type === ErrorType.CONFIG_ERROR) {
            actions.push('Open Settings');
        }

        const result = await vscode.window.showErrorMessage(userMessage, ...actions);

        if (result === 'Retry') {
            return 'retry';
        }
        if (result === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'traycer');
            return 'settings';
        }

        return undefined;
    }

    /**
     * Get error history
     */
    public getErrorHistory(): ErrorContext[] {
        return [...this.errorHistory];
    }

    /**
     * Clear error history
     */
    public clearHistory(): void {
        this.errorHistory = [];
    }

    /**
     * Show output channel
     */
    public showOutputChannel(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}

// Export singleton instance
export const errorLogger = ErrorLogger.getInstance();
