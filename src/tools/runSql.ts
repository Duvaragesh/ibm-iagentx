import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { RunSqlInput, RunSqlOutput } from '../types.js';

const MAX_ROWS_DEFAULT = 100;
const MAX_ROWS_LIMIT = 1000;

function isSelectOnly(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  return /^(SELECT|WITH|VALUES)\b/.test(trimmed);
}

/**
 * V7R6+ requires TABLE() wrapper for table functions: FROM TABLE(QSYS2.func(...))
 * If SQL0104 is raised and the query has an unwrapped table function, retry with it wrapped.
 */
function wrapTableFunctions(query: string): string {
  return query.replace(
    /\b(FROM|JOIN)\s+(?!TABLE\s*\()([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*\s*\()/gi,
    (_match, kw: string, fn: string) => `${kw} TABLE(${fn}`
  );
}

export class RunSqlTool implements vscode.LanguageModelTool<RunSqlInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunSqlInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { query, maxRows, offset } = options.input;
    const limit = Math.min(maxRows ?? MAX_ROWS_DEFAULT, MAX_ROWS_LIMIT);
    const skip = Math.max(offset ?? 0, 0);

    if (!isSelectOnly(query)) {
      throw new Error('Only SELECT statements are allowed. DML and DDL are not permitted.');
    }

    const connection = getConnection();
    let rows: Record<string, unknown>[];
    try {
      rows = await connection.runSQL(query) as Record<string, unknown>[];
    } catch (e) {
      // V7R6+ requires TABLE() wrapper for table functions — auto-retry once
      if (/SQL0104/i.test(String(e))) {
        const rewritten = wrapTableFunctions(query);
        if (rewritten !== query) {
          rows = await connection.runSQL(rewritten) as Record<string, unknown>[];
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // TypeScript-level offset slicing — avoids CTE-wrapping complexity
    const paged = rows.slice(skip, skip + limit + 1);
    const hasMore = paged.length > limit;
    const sliced = paged.slice(0, limit);
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];

    const result: RunSqlOutput = { rows: sliced, columns, rowCount: sliced.length, offset: skip, hasMore };
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
