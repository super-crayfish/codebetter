import * as vscode from 'vscode';
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
                description: 'List contents of a directory',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' }
                    }
                },
                execute: async (args: { path: string }) => {
                    const uri = vscode.Uri.file(args.path);
                    const entries = await vscode.workspace.fs.readDirectory(uri);
                    return entries.map(([name, type]) => ({
                        name,
                        type: type === vscode.FileType.Directory ? 'directory' : 'file'
                    }));
                }
            },
            {
                name: 'read_file',
                description: 'Read content of a file',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' }
                    }
                },
                execute: async (args: { path: string }) => {
                    const uri = vscode.Uri.file(args.path);
                    const content = await vscode.workspace.fs.readFile(uri);
                    return Buffer.from(content).toString('utf8');
                }
            }
        ];
    }
}
