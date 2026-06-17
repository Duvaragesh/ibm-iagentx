import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { RunClCommandInput, RunClCommandOutput } from '../types.js';

// Read-only CL command prefixes allowed in ILE mode by default
const DEFAULT_ALLOWED_PREFIXES = ['DSP', 'LST', 'WRK', 'CHK', 'PRT', 'DMP', 'RTV', 'QRY'];

function isAllowedIle(command: string, allowedPrefixes: string[]): boolean {
  const verb = command.trim().toUpperCase().split(/\s+/)[0];
  return allowedPrefixes.some(p => verb.startsWith(p));
}

// CPYSPLF is allowed only when writing to TOFILE(*TOSTMF) with a path under /tmp/
function validateCpySplf(command: string): boolean {
  const tofileMatch = /TOFILE\s*\(\s*\*TOSTMF\s*\)/i.test(command);
  const tostmfMatch = /TOSTMF\s*\(\s*'(\/[^']+)'\s*\)/i.exec(command);
  return tofileMatch && tostmfMatch !== null && tostmfMatch[1].startsWith('/tmp/');
}

export class RunClCommandTool implements vscode.LanguageModelTool<RunClCommandInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunClCommandInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { command } = options.input;
    const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
    const allowedPrefixes: string[] = cfg.get('clAllowedPrefixes') ?? DEFAULT_ALLOWED_PREFIXES;

    const verb = command.trim().toUpperCase().split(/\s+/)[0];
    if (verb === 'CPYSPLF') {
      if (!validateCpySplf(command)) {
        throw new Error('CPYSPLF is only permitted with TOFILE(*TOSTMF) and a destination path under /tmp/');
      }
    } else if (!isAllowedIle(command, allowedPrefixes)) {
      throw new Error(
        `Command not allowed: only read-only commands starting with ${allowedPrefixes.join(', ')} are permitted.`
      );
    }

    const connection = getConnection();
    const result = await connection.runCommand({ command, environment: 'ile' });

    const output: RunClCommandOutput = {
      output: result.stdout ?? '',
      stderr: result.stderr ?? undefined,
      exitCode: result.code ?? 0,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(output, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunClCommandInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Running CL command: ${options.input.command}` };
  }
}
