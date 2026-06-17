import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import { castUtf8 } from '../utils/ccsidCast.js';
import type { GetFileFieldsInput, GetFileFieldsOutput } from '../types.js';

export class GetFileFieldsTool implements vscode.LanguageModelTool<GetFileFieldsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetFileFieldsInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, file } = options.input;
    const lib = library.toUpperCase();
    const fileName = file.toUpperCase();

    const query = `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, ${castUtf8('COLUMN_TEXT')} AS COLUMN_TEXT, ORDINAL_POSITION FROM QSYS2.SYSCOLUMNS2 WHERE TABLE_SCHEMA = '${lib}' AND TABLE_NAME = '${fileName}' ORDER BY ORDINAL_POSITION`;

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    const fields = rows.map(r => ({
      name: String(r['COLUMN_NAME'] ?? ''),
      type: String(r['DATA_TYPE'] ?? ''),
      length: r['LENGTH'] != null ? Number(r['LENGTH']) : 0,
      precision: r['NUMERIC_PRECISION'] != null ? Number(r['NUMERIC_PRECISION']) : null,
      scale: r['NUMERIC_SCALE'] != null ? Number(r['NUMERIC_SCALE']) : null,
      nullable: String(r['IS_NULLABLE'] ?? 'N').toUpperCase() === 'Y',
      default: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : null,
      description: r['COLUMN_TEXT'] != null ? String(r['COLUMN_TEXT']) : '',
      position: Number(r['ORDINAL_POSITION'] ?? 0),
    }));

    const result: GetFileFieldsOutput = { library: lib, file: fileName, fields, total: fields.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetFileFieldsInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Getting field definitions for ${options.input.library}/${options.input.file}` };
  }
}
