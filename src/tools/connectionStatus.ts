import * as vscode from 'vscode';
import type { CodeForIBMi } from '@halcyontech/vscode-ibmi-types';
import type { ConnectionStatusOutput } from '../types.js';

export class ConnectionStatusTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const ext = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
    if (!ext?.isActive) {
      const result: ConnectionStatusOutput = { connected: false };
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
      ]);
    }
    const conn = ext.exports.instance.getConnection();
    if (!conn) {
      const result: ConnectionStatusOutput = { connected: false };
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
      ]);
    }
    const result: ConnectionStatusOutput = {
      connected: true,
      host: conn.currentHost,
      user: conn.currentUser,
      port: conn.currentPort,
      connectionName: conn.currentConnectionName,
    };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: 'Checking IBM i connection status' };
  }
}
