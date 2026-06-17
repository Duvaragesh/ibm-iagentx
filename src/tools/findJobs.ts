import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { FindJobsInput, FindJobsOutput, JobInfo } from '../types.js';

export class FindJobsTool implements vscode.LanguageModelTool<FindJobsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FindJobsInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { jobname, username, status = 'ALL', date_from, date_to, subsystem } = options.input;
    const connection = getConnection();

    const jobPattern = jobname.toUpperCase().endsWith('*')
      ? jobname.toUpperCase().slice(0, -1) + '%'
      : jobname.toUpperCase();

    const jobs: JobInfo[] = [];

    if (status === 'ACTIVE' || status === 'ALL') {
      const conditions: string[] = ['1=1'];
      if (username) { conditions.push(`JOB_USER = '${username.toUpperCase()}'`); }
      if (subsystem) { conditions.push(`SUBSYSTEM = '${subsystem.toUpperCase()}'`); }
      const activeQuery =
        `SELECT JOB_NAME_SHORT, JOB_USER, JOB_NUMBER, JOB_STATUS, JOB_ENTERED_SYSTEM_TIME, SUBSYSTEM ` +
        `FROM TABLE(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '${jobPattern}')) ` +
        `WHERE ${conditions.join(' AND ')}`;
      const rows = await connection.runSQL(activeQuery) as Record<string, unknown>[];
      for (const r of rows) {
        jobs.push({
          job_number: String(r['JOB_NUMBER'] ?? ''),
          job_user: String(r['JOB_USER'] ?? ''),
          job_name: String(r['JOB_NAME_SHORT'] ?? ''),
          status: 'ACTIVE',
          end_time: null,
          completion_code: null,
          subsystem: r['SUBSYSTEM'] != null ? String(r['SUBSYSTEM']) : null,
        });
      }
    }

    if (status === 'OUTQ' || status === 'ALL') {
      const startTime = date_from ? `'${date_from} 00:00:00'` : 'CURRENT_TIMESTAMP - 7 DAYS';
      const conditions: string[] = [`MESSAGE_ID = 'CPF1164'`, `FROM_JOB_NAME LIKE '${jobPattern}'`];
      if (username) { conditions.push(`FROM_JOB_USER = '${username.toUpperCase()}'`); }
      if (date_to) { conditions.push(`MESSAGE_TIMESTAMP <= '${date_to} 23:59:59'`); }
      const endedQuery =
        `SELECT FROM_JOB_NAME, FROM_JOB_USER, FROM_JOB_NUMBER, FROM_JOB, MESSAGE_TIMESTAMP, MESSAGE_TEXT ` +
        `FROM TABLE(QSYS2.HISTORY_LOG_INFO(START_TIME => ${startTime})) ` +
        `WHERE ${conditions.join(' AND ')} ` +
        `ORDER BY MESSAGE_TIMESTAMP DESC`;
      const rows = await connection.runSQL(endedQuery) as Record<string, unknown>[];
      for (const r of rows) {
        const msgText = String(r['MESSAGE_TEXT'] ?? '');
        const codeMatch = /end code (\d+)/i.exec(msgText);
        jobs.push({
          job_number: String(r['FROM_JOB_NUMBER'] ?? ''),
          job_user: String(r['FROM_JOB_USER'] ?? ''),
          job_name: String(r['FROM_JOB_NAME'] ?? ''),
          status: 'ENDED',
          end_time: r['MESSAGE_TIMESTAMP'] != null ? String(r['MESSAGE_TIMESTAMP']) : null,
          completion_code: codeMatch ? Number(codeMatch[1]) : null,
          subsystem: null,
        });
      }
    }

    const output: FindJobsOutput = { jobs, total: jobs.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(output, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<FindJobsInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Searching for jobs matching ${options.input.jobname}` };
  }
}
