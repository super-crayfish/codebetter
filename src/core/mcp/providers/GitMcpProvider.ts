import { exec } from 'child_process';
import { promisify } from 'util';
import { PhaseContext } from '../../types';
import { McpProvider, McpTool } from '../McpRegistry';

const execAsync = promisify(exec);

export class GitMcpProvider implements McpProvider {
    name = 'git';

    async provideContext(ctx: PhaseContext): Promise<Record<string, unknown>> {
        const rootPath = ctx.workspaceRoot;
        if (!rootPath) {
            return { error: 'No workspace root provided' };
        }

        try {
            const [branch, status, lastCommit] = await Promise.all([
                this.runGit(rootPath, 'rev-parse --abbrev-ref HEAD'),
                this.runGit(rootPath, 'status --short'),
                this.runGit(rootPath, 'log -1 --pretty=format:"%s"')
            ]);

            return {
                branch: branch.trim(),
                status: status.trim().split('\n').filter(s => s),
                lastCommit: lastCommit.trim()
            };
        } catch (err) {
            return { error: 'Not a git repository or git not found' };
        }
    }

    getTools(): McpTool[] {
        return [
            {
                name: 'git_status',
                description: 'Get the current git status including modified, staged, and untracked files.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
                },
                execute: async () => {
                    try {
                        const rootPath = this.getWorkspaceRoot();
                        if (!rootPath) {
                            return { success: false, error: 'No workspace root' };
                        }

                        const status = await this.runGit(rootPath, 'status --porcelain');
                        const lines = status.trim().split('\n').filter(s => s);
                        
                        const modified: string[] = [];
                        const staged: string[] = [];
                        const untracked: string[] = [];

                        for (const line of lines) {
                            const indexStatus = line[0];
                            const workTreeStatus = line[1];
                            const file = line.substring(3);

                            if (indexStatus === '?' && workTreeStatus === '?') {
                                untracked.push(file);
                            } else if (indexStatus !== ' ' && indexStatus !== '?') {
                                staged.push(file);
                            }
                            if (workTreeStatus === 'M' || workTreeStatus === 'D') {
                                modified.push(file);
                            }
                        }

                        return {
                            success: true,
                            modified,
                            staged,
                            untracked,
                            clean: lines.length === 0
                        };
                    } catch (err: any) {
                        return { success: false, error: err.message };
                    }
                }
            },
            {
                name: 'git_branch',
                description: 'Get the current branch name and list of all branches.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
                },
                execute: async () => {
                    try {
                        const rootPath = this.getWorkspaceRoot();
                        if (!rootPath) {
                            return { success: false, error: 'No workspace root' };
                        }

                        const [current, branches] = await Promise.all([
                            this.runGit(rootPath, 'rev-parse --abbrev-ref HEAD'),
                            this.runGit(rootPath, 'branch --list')
                        ]);

                        const branchList = branches.trim().split('\n')
                            .map(b => b.replace(/^\*?\s*/, '').trim())
                            .filter(b => b);

                        return {
                            success: true,
                            current: current.trim(),
                            branches: branchList
                        };
                    } catch (err: any) {
                        return { success: false, error: err.message };
                    }
                }
            },
            {
                name: 'git_diff',
                description: 'Get the diff of changes. Can show staged, unstaged, or specific file diffs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        staged: {
                            type: 'boolean',
                            description: 'If true, show staged changes. If false, show unstaged changes.'
                        },
                        file: {
                            type: 'string',
                            description: 'Optional specific file to diff'
                        }
                    },
                    required: []
                },
                execute: async (args: { staged?: boolean; file?: string }) => {
                    try {
                        const rootPath = this.getWorkspaceRoot();
                        if (!rootPath) {
                            return { success: false, error: 'No workspace root' };
                        }

                        let command = 'diff';
                        if (args.staged) {
                            command += ' --staged';
                        }
                        if (args.file) {
                            command += ` -- "${args.file}"`;
                        }

                        const diff = await this.runGit(rootPath, command);
                        return {
                            success: true,
                            diff: diff || '(no changes)',
                            staged: args.staged || false,
                            file: args.file || null
                        };
                    } catch (err: any) {
                        return { success: false, error: err.message };
                    }
                }
            },
            {
                name: 'git_log',
                description: 'Get recent commit history.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'number',
                            description: 'Number of commits to show (default: 10)'
                        },
                        file: {
                            type: 'string',
                            description: 'Optional file to show history for'
                        }
                    },
                    required: []
                },
                execute: async (args: { count?: number; file?: string }) => {
                    try {
                        const rootPath = this.getWorkspaceRoot();
                        if (!rootPath) {
                            return { success: false, error: 'No workspace root' };
                        }

                        const count = args.count || 10;
                        let command = `log -${count} --pretty=format:"%h|%an|%ar|%s"`;
                        if (args.file) {
                            command += ` -- "${args.file}"`;
                        }

                        const log = await this.runGit(rootPath, command);
                        const commits = log.trim().split('\n')
                            .filter(l => l)
                            .map(line => {
                                const [hash, author, date, ...messageParts] = line.split('|');
                                return {
                                    hash,
                                    author,
                                    date,
                                    message: messageParts.join('|')
                                };
                            });

                        return {
                            success: true,
                            commits,
                            count: commits.length
                        };
                    } catch (err: any) {
                        return { success: false, error: err.message };
                    }
                }
            }
        ];
    }

    private getWorkspaceRoot(): string | undefined {
        const vscode = require('vscode');
        return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    }

    private async runGit(cwd: string, command: string): Promise<string> {
        const { stdout } = await execAsync(`git ${command}`, { cwd });
        return stdout;
    }
}
