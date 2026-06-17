import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { CheckObjectInput, CheckObjectOutput } from '../types.js';

export class CheckObjectTool implements vscode.LanguageModelTool<CheckObjectInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CheckObjectInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, name, objectType } = options.input;
    const lib = library.toUpperCase();
    const objName = name.toUpperCase();
    const objType = objectType.toUpperCase();

    const query = `SELECT OBJNAME, OBJATTRIBUTE, OBJTEXT FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}', OBJECT_NAME => '${objName}')) FETCH FIRST 1 ROW ONLY`;

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    let result: CheckObjectOutput;
    if (rows.length === 0) {
      result = { exists: false, library: lib, name: objName, objectType: objType };
    } else {
      const r = rows[0];
      result = {
        exists: true,
        library: lib,
        name: String(r['OBJNAME'] ?? ''),
        objectType: objType,
        attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : undefined,
        description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : undefined,
      };
    }

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CheckObjectInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Checking if ${options.input.library}/${options.input.name} (${options.input.objectType}) exists` };
  }
}
