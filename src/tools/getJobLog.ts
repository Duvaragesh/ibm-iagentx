import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetJobLogInput, GetJobLogOutput, JobMessage } from '../types.js';

export class GetJobLogTool implements vscode.LanguageModelTool<GetJobLogInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetJobLogInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { job } = options.input;
    const connection = getConnection();

    // Retrieve job log via SQL from QSYS2.JOBLOG_INFO — available on IBM i 7.2+
    let query: string;
    if (job) {
      const parts = job.split('/');
      if (parts.length === 3) {
        const [number, user, name] = parts;
        query = `SELECT MESSAGE_ID, MESSAGE_TEXT, SEVERITY, MESSAGE_TYPE FROM TABLE(QSYS2.JOBLOG_INFO('${number}/${user}/${name}')) ORDER BY ORDINAL_POSITION DESC FETCH FIRST 100 ROWS ONLY`;
      } else {
        throw new Error('job must be in NUMBER/USER/NAME format, e.g. 123456/MYUSER/QZDASOINIT');
      }
    } else {
      // Current job
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, SEVERITY, MESSAGE_TYPE FROM TABLE(QSYS2.JOBLOG_INFO('*')) ORDER BY ORDINAL_POSITION DESC FETCH FIRST 100 ROWS ONLY`;
    }

    const rows = await connection.runSQL(query) as Record<string, unknown>[];
    const messages: JobMessage[] = rows.map(r => ({
      id: String(r['MESSAGE_ID'] ?? ''),
      text: String(r['MESSAGE_TEXT'] ?? ''),
      severity: r['SEVERITY'] !== null && r['SEVERITY'] !== undefined ? Number(r['SEVERITY']) : undefined,
      type: r['MESSAGE_TYPE'] !== null && r['MESSAGE_TYPE'] !== undefined ? String(r['MESSAGE_TYPE']) : undefined,
    }));

    const result: GetJobLogOutput = { messages, total: messages.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetJobLogInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const label = options.input.job ?? 'current job';
    return { invocationMessage: `Retrieving job log for ${label}` };
  }
}
