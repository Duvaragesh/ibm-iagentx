import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetSpoolFileInput, GetSpoolFileOutput } from '../types.js';
import { readIfsAsText } from '../utils/ifsRead.js';

export class GetSpoolFileTool implements vscode.LanguageModelTool<GetSpoolFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetSpoolFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { job, splfname, splfnbr, startLine, lineCount } = options.input;

    const parts = job.split('/');
    if (parts.length !== 3) {
      throw new Error('job must be in NUMBER/USER/NAME format, e.g. 123456/MYUSER/QZDASOINIT');
    }
    const [jobNumber] = parts;
    const connection = getConnection();

    // Resolve spool file number
    const splfnbrFilter = splfnbr != null ? ` AND SPOOLED_FILE_NUMBER = ${Number(splfnbr)}` : '';
    const metaQuery = `SELECT SPOOLED_FILE_NUMBER FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${job}')) WHERE SPOOLED_FILE_NAME = '${splfname.toUpperCase()}'${splfnbrFilter} ORDER BY SPOOLED_FILE_NUMBER DESC FETCH FIRST 1 ROW ONLY`;

    let metaRows: Record<string, unknown>[];
    try {
      metaRows = await connection.runSQL(metaQuery) as Record<string, unknown>[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|CPF3307|CPF3330/i.test(msg)) {
        throw new Error(`Job ${job} not found`);
      }
      throw e;
    }

    if (metaRows.length === 0) {
      throw new Error(`No spool file ${splfname.toUpperCase()} found for job ${job}`);
    }
    const resolvedSplfnbr = Number(metaRows[0]['SPOOLED_FILE_NUMBER']);

    // Copy spool to IFS temp file
    const tmpPath = `/tmp/iagentx_${jobNumber}_${splfname.toUpperCase()}_${resolvedSplfnbr}.txt`;
    const splfnbrClause = splfnbr != null ? ` SPLFNBR(${resolvedSplfnbr})` : '';
    const cpySplf = `CPYSPLF FILE(${splfname.toUpperCase()}) TOFILE(*TOSTMF) JOB(${job}) TOSTMF('${tmpPath}')${splfnbrClause} STMFOPT(*REPLACE)`;

    const cmdResult = await connection.runCommand({ command: cpySplf, environment: 'ile' });
    if (cmdResult.code !== 0) {
      const stderr = cmdResult.stderr ?? '';
      if (/not authorized|CPF2189|CPF2177/i.test(stderr)) {
        throw new Error(`Not authorised to spool file for job ${job}`);
      }
      if (/not found|CPF3307|CPF3330/i.test(stderr)) {
        throw new Error(`Job ${job} not found`);
      }
      throw new Error(`CPYSPLF failed: ${stderr || cmdResult.stdout || 'unknown error'}`);
    }

    const { text: fullContent } = await readIfsAsText(connection, tmpPath);
    await connection.runCommand({ command: `RMVLNK OBJLNK('${tmpPath}')`, environment: 'ile' }).catch(() => {});

    const allLines = fullContent.split('\n');
    const totalLines = allLines.length;

    // Apply line range if requested (1-based startLine)
    const start = Math.max((startLine ?? 1) - 1, 0);
    const end = lineCount != null ? start + lineCount : totalLines;
    const selectedLines = allLines.slice(start, end);

    const output: GetSpoolFileOutput = {
      job,
      splfname: splfname.toUpperCase(),
      splfnbr: resolvedSplfnbr,
      content: selectedLines.join('\n'),
      startLine: start + 1,
      returnedLines: selectedLines.length,
      totalLines,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(output, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetSpoolFileInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Retrieving spool file ${options.input.splfname} for job ${options.input.job}` };
  }
}
