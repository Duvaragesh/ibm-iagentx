import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { ListSpoolFilesInput, ListSpoolFilesOutput } from '../types.js';

export class ListSpoolFilesTool implements vscode.LanguageModelTool<ListSpoolFilesInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListSpoolFilesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { job, username, splfname, maxFiles } = options.input;
    const max = Math.min(maxFiles ?? 50, 200);

    const selectClause = `SELECT SPOOLED_FILE_NAME, SPOOLED_FILE_NUMBER, JOB_NAME, STATUS, TOTAL_PAGES, CREATE_TIMESTAMP, OUTPUT_QUEUE_NAME, OUTPUT_QUEUE_LIBRARY_NAME`;

    let query: string;
    if (job) {
      const parts = job.split('/');
      if (parts.length !== 3) {
        throw new Error('job must be in NUMBER/USER/NAME format');
      }
      const splfFilter = splfname ? ` WHERE SPOOLED_FILE_NAME = '${splfname.toUpperCase()}'` : '';
      query = `${selectClause} FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${job}'))${splfFilter} ORDER BY SPOOLED_FILE_NUMBER DESC FETCH FIRST ${max} ROWS ONLY`;
    } else {
      const conditions: string[] = [];
      if (username) { conditions.push(`JOB_USER_NAME = '${username.toUpperCase()}'`); }
      if (splfname) { conditions.push(`SPOOLED_FILE_NAME = '${splfname.toUpperCase()}'`); }
      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      query = `${selectClause} FROM TABLE(QSYS2.SPOOLED_FILE_INFO())${whereClause} ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST ${max} ROWS ONLY`;
    }

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    const spoolFiles = rows.map(r => ({
      job: String(r['JOB_NAME'] ?? ''),
      splfname: String(r['SPOOLED_FILE_NAME'] ?? ''),
      splfnbr: Number(r['SPOOLED_FILE_NUMBER'] ?? 0),
      status: r['STATUS'] != null ? String(r['STATUS']) : '',
      pages: r['TOTAL_PAGES'] != null ? Number(r['TOTAL_PAGES']) : null,
      createTime: r['CREATE_TIMESTAMP'] != null ? String(r['CREATE_TIMESTAMP']) : null,
      outputQueue: r['OUTPUT_QUEUE_NAME'] != null ? String(r['OUTPUT_QUEUE_NAME']) : '',
      outputQueueLibrary: r['OUTPUT_QUEUE_LIBRARY_NAME'] != null ? String(r['OUTPUT_QUEUE_LIBRARY_NAME']) : '',
    }));

    const result: ListSpoolFilesOutput = { spoolFiles, total: spoolFiles.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListSpoolFilesInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const scope = options.input.job ?? options.input.username ?? 'current user';
    return { invocationMessage: `Listing spool files for ${scope}` };
  }
}
