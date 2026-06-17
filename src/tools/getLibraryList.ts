import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetLibraryListOutput } from '../types.js';

export class GetLibraryListTool implements vscode.LanguageModelTool<Record<never, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<never, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const rows = await getConnection().runSQL(
      `SELECT SYSTEM_SCHEMA_NAME, TYPE, SCHEMA_POSITION, SCHEMA_TEXT FROM QSYS2.LIBRARY_LIST_INFO ORDER BY SCHEMA_POSITION`
    ) as Record<string, unknown>[];

    const libraries = rows.map(r => ({
      library: String(r['SYSTEM_SCHEMA_NAME'] ?? ''),
      type: String(r['TYPE'] ?? ''),
      position: Number(r['SCHEMA_POSITION'] ?? 0),
      description: r['SCHEMA_TEXT'] != null ? String(r['SCHEMA_TEXT']) : '',
    }));

    const result: GetLibraryListOutput = { libraries, total: libraries.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<never, never>>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: 'Retrieving library list' };
  }
}
