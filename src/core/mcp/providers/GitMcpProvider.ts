import { exec } from 'child_process';
import { promisify } from 'util';
import { PhaseContext } from '../../types';
import { McpProvider } from '../McpRegistry';

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

    private async runGit(cwd: string, command: string): Promise<string> {
        const { stdout } = await execAsync(`git ${command}`, { cwd });
        return stdout;
    }
}
