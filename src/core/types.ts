import * as vscode from 'vscode';

export interface PhaseContext {
    workspaceRoot: string;
    selection?: {
        file: string;
        range: vscode.Range;
    };
    mcpContext: Record<string, unknown>; // Dynamic context from MCPs
    history: PhaseResult[];
}

export interface PhaseResult {
    phase: 'phases' | 'plan' | 'review';
    output: string;
    artifacts?: string[];
    timestamp: number;
}

export interface ReviewFinding {
    severity: 'info' | 'warn' | 'error';
    file: string;
    line?: number;
    message: string;
    suggestion?: string;
}

export interface PlanStep {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    files?: string[];
}

export interface ImplementationPlan {
    id: string;
    title: string;
    steps: PlanStep[];
}
