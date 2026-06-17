import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetDataAreaInput, GetDataAreaOutput } from '../types.js';

export class GetDataAreaTool implements vscode.LanguageModelTool<GetDataAreaInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetDataAreaInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, name } = options.input;
    const lib = library.toUpperCase();
    const daName = name.toUpperCase();

    const query = `SELECT DATA_AREA_VALUE, DATA_AREA_TYPE, DATA_AREA_LENGTH, DATA_AREA_TEXT FROM TABLE(QSYS2.DATA_AREA_INFO(DATA_AREA_NAME => '${daName}', DATA_AREA_LIBRARY => '${lib}')) FETCH FIRST 1 ROW ONLY`;

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    if (rows.length === 0) {
      throw new Error(`Data area ${lib}/${daName} not found`);
    }

    const r = rows[0];
    const result: GetDataAreaOutput = {
      library: lib,
      name: daName,
      value: r['DATA_AREA_VALUE'] != null ? String(r['DATA_AREA_VALUE']) : '',
      dataType: r['DATA_AREA_TYPE'] != null ? String(r['DATA_AREA_TYPE']) : '',
      length: r['DATA_AREA_LENGTH'] != null ? Number(r['DATA_AREA_LENGTH']) : 0,
      description: r['DATA_AREA_TEXT'] != null ? String(r['DATA_AREA_TEXT']) : '',
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetDataAreaInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Reading data area ${options.input.library}/${options.input.name}` };
  }
}
