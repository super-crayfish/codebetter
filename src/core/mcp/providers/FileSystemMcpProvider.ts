import * as vscode from 'vscode';
import * as path from 'path';
import { PhaseContext } from '../../types';
import { McpProvider, McpTool } from '../McpRegistry';

export class FileSystemMcpProvider implements McpProvider {
    name = 'filesystem';

    async provideContext(ctx: PhaseContext): Promise<Record<string, unknown>> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return { error: 'No workspace folders found' };
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        // If there's a selection, provide its content
        let selectionContext = {};
        if (ctx.selection) {
            try {
                const doc = await vscode.workspace.openTextDocument(ctx.selection.file);
                const text = doc.getText(ctx.selection.range);
                selectionContext = {
                    file: ctx.selection.file,
                    content: text,
                    range: {
                        start: ctx.selection.range.start.line,
                        end: ctx.selection.range.end.line
                    }
                };
            } catch (err) {
                console.error('Failed to read selection context:', err);
            }
        }

        // List files (limited for performance)
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);

        return {
            rootPath,
            selection: selectionContext,
            fileCount: files.length,
            sampleFiles: files.slice(0, 10).map(f => vscode.workspace.asRelativePath(f))
        };
    }

    getTools(): McpTool[] {
        return [
            {
                name: 'list_dir',
                description: 'List contents of a directory in the workspace. Returns file and directory names with their types.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { 
                            type: 'string',
                            description: 'Relative or absolute path to the directory to list'
                        }
                    },
                    required: ['path']
                },
                execute: async (args: { path: string }) => {
                    try {
                        const targetPath = this.resolvePath(args.path);
                        const uri = vscode.Uri.file(targetPath);
                        const entries = await vscode.workspace.fs.readDirectory(uri);
                        return {
                            success: true,
                            path: targetPath,
                            entries: entries.map(([name, type]) => ({
                                name,
                                type: type === vscode.FileType.Directory ? 'directory' : 'file'
                            }))
                        };
                    } catch (err: any) {
                        return {
                            success: false,
                            error: `Failed to list directory: ${err.message}`
                        };
                    }
                }
            },
            {
                name: 'read_file',
                description: 'Read the content of a file in the workspace. Returns the file content as text.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { 
                            type: 'string',
                            description: 'Relative or absolute path to the file to read'
                        },
                        maxLines: {
                            type: 'number',
                            description: 'Maximum number of lines to read (optional, default: all)'
                        }
                    },
                    required: ['path']
                },
                execute: async (args: { path: string; maxLines?: number }) => {
                    try {
                        const targetPath = this.resolvePath(args.path);
                        const uri = vscode.Uri.file(targetPath);
                        const content = await vscode.workspace.fs.readFile(uri);
                        let text = Buffer.from(content).toString('utf8');
                        
                        if (args.maxLines && args.maxLines > 0) {
                            const lines = text.split('\n');
                            text = lines.slice(0, args.maxLines).join('\n');
                            if (lines.length > args.maxLines) {
                                text += `\n... (${lines.length - args.maxLines} more lines)`;
                            }
                        }
                        
                        return {
                            success: true,
                            path: targetPath,
                            content: text,
                            lineCount: text.split('\n').length
                        };
                    } catch (err: any) {
                        return {
                            success: false,
                            error: `Failed to read file: ${err.message}`
                        };
                    }
                }
            },
            {
                name: 'search_files',
                description: 'Search for files matching a glob pattern in the workspace.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pattern: {
                            type: 'string',
                            description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")'
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of results to return (default: 50)'
                        }
                    },
                    required: ['pattern']
                },
                execute: async (args: { pattern: string; maxResults?: number }) => {
                    try {
                        const maxResults = args.maxResults || 50;
                        const files = await vscode.workspace.findFiles(
                            args.pattern,
                            '**/node_modules/**',
                            maxResults
                        );
                        return {
                            success: true,
                            pattern: args.pattern,
                            files: files.map(f => vscode.workspace.asRelativePath(f)),
                            count: files.length,
                            truncated: files.length >= maxResults
                        };
                    } catch (err: any) {
                        return {
                            success: false,
                            error: `Failed to search files: ${err.message}`
                        };
                    }
                }
            }
        ];
    }

    private resolvePath(inputPath: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return inputPath;
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        
        // If it's already absolute, return as is
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }
        
        // Otherwise, resolve relative to workspace root
        return path.join(rootPath, inputPath);
    }
}
