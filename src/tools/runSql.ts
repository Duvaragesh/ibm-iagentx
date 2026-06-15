import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { RunSqlInput, RunSqlOutput } from '../types.js';

const MAX_ROWS_DEFAULT = 100;
const MAX_ROWS_LIMIT = 1000;

function isSelectOnly(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  // Allow SELECT, WITH (CTEs), VALUES
  return /^(SELECT|WITH|VALUES)\b/.test(trimmed);
}

export class RunSqlTool implements vscode.LanguageModelTool<RunSqlInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunSqlInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { query, maxRows } = options.input;
    const limit = Math.min(maxRows ?? MAX_ROWS_DEFAULT, MAX_ROWS_LIMIT);

    if (!isSelectOnly(query)) {
      throw new Error('Only SELECT statements are allowed. DML and DDL are not permitted.');
    }

    const connection = getConnection();
    const rows = await connection.runSQL(query);
    const sliced = rows.slice(0, limit) as Record<string, unknown>[];
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];

    const result: RunSqlOutput = { rows: sliced, columns, rowCount: sliced.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunSqlInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const preview = options.input.query.slice(0, 80).replace(/\n/g, ' ');
    return { invocationMessage: `Running SQL: ${preview}` };
  }
}
