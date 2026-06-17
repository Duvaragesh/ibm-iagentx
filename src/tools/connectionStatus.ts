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

    let osVersion: string | undefined;
    try {
      const rows = await conn.runSQL(
        `SELECT OS_RELEASE FROM TABLE(QSYS2.SYSTEM_STATUS_INFO()) FETCH FIRST 1 ROW ONLY`
      ) as Record<string, unknown>[];
      if (rows.length > 0 && rows[0]['OS_RELEASE'] != null) {
        osVersion = String(rows[0]['OS_RELEASE']);
      }
    } catch {
      // OS version is optional — do not fail the whole tool if unsupported
    }

    const result: ConnectionStatusOutput = {
      connected: true,
      host: conn.currentHost,
      user: conn.currentUser,
      port: conn.currentPort,
      connectionName: conn.currentConnectionName,
      osVersion,
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
