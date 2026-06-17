import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetJobLogInput, GetJobLogOutput, JobMessage } from '../types.js';
import { readIfsAsText } from '../utils/ifsRead.js';

export class GetJobLogTool implements vscode.LanguageModelTool<GetJobLogInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetJobLogInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { job, minSeverity, messageType, maxMessages, includeTimestamp } = options.input;
    const connection = getConnection();
    const fetchLimit = Math.min(maxMessages ?? 100, 500);

    const conditions: string[] = [];
    if (minSeverity !== undefined) { conditions.push(`SEVERITY >= ${Number(minSeverity)}`); }
    if (messageType) { conditions.push(`MESSAGE_TYPE = '${messageType.toUpperCase()}'`); }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const timestampCol = includeTimestamp ? ', MESSAGE_TIMESTAMP' : '';
    let query: string;
    if (job) {
      const parts = job.split('/');
      if (parts.length === 3) {
        const [number, user, name] = parts;
        query = `SELECT MESSAGE_ID, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, SEVERITY, MESSAGE_TYPE${timestampCol} FROM TABLE(QSYS2.JOBLOG_INFO('${number}/${user}/${name}'))${whereClause} ORDER BY ORDINAL_POSITION DESC FETCH FIRST ${fetchLimit} ROWS ONLY`;
      } else {
        throw new Error('job must be in NUMBER/USER/NAME format, e.g. 123456/MYUSER/QZDASOINIT');
      }
    } else {
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, SEVERITY, MESSAGE_TYPE${timestampCol} FROM TABLE(QSYS2.JOBLOG_INFO('*'))${whereClause} ORDER BY ORDINAL_POSITION DESC FETCH FIRST ${fetchLimit} ROWS ONLY`;
    }

    let messages: JobMessage[];
    try {
      const rows = await connection.runSQL(query) as Record<string, unknown>[];
      messages = rows.map(r => ({
        id: String(r['MESSAGE_ID'] ?? ''),
        text: String(r['MESSAGE_TEXT'] ?? ''),
        secondLevelText: r['MESSAGE_SECOND_LEVEL_TEXT'] ? String(r['MESSAGE_SECOND_LEVEL_TEXT']) : undefined,
        severity: r['SEVERITY'] !== null && r['SEVERITY'] !== undefined ? Number(r['SEVERITY']) : undefined,
        type: r['MESSAGE_TYPE'] !== null && r['MESSAGE_TYPE'] !== undefined ? String(r['MESSAGE_TYPE']) : undefined,
        sendTime: includeTimestamp && r['MESSAGE_TIMESTAMP'] != null ? String(r['MESSAGE_TIMESTAMP']) : undefined,
      }));
    } catch {
      // For ended jobs, fall back to reading the QPJOBLOG spool file via CPYSPLF
      if (!job) {
        throw new Error('Job log for current job is unavailable');
      }
      const parts = job.split('/');
      const [jobNumber] = parts;
      const tmpPath = `/tmp/iagentx_joblog_${jobNumber}.txt`;
      const cmdResult = await connection.runCommand({
        command: `CPYSPLF FILE(QPJOBLOG) TOFILE(*TOSTMF) JOB(${job}) TOSTMF('${tmpPath}') STMFOPT(*REPLACE)`,
        environment: 'ile',
      });
      if (cmdResult.code !== 0) {
        messages = [{ id: 'SPOOL', text: 'Job has ended and spool file is no longer available', type: 'SPOOL' }];
      } else {
        const { text } = await readIfsAsText(connection, tmpPath);
        await connection.runCommand({ command: `RMVLNK OBJLNK('${tmpPath}')`, environment: 'ile' }).catch(() => {});
        messages = [{ id: 'SPOOL', text, type: 'SPOOL' }];
      }
    }

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
    const severityNote = options.input.minSeverity !== undefined ? ` (severity ≥ ${options.input.minSeverity})` : '';
    const typeNote = options.input.messageType ? ` type=${options.input.messageType}` : '';
    return { invocationMessage: `Retrieving job log for ${label}${severityNote}${typeNote}` };
  }
}
