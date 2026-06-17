import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetObjectInfoInput, GetObjectInfoOutput } from '../types.js';

export class GetObjectInfoTool implements vscode.LanguageModelTool<GetObjectInfoInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetObjectInfoInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, name, objectType } = options.input;
    const lib = library.toUpperCase();
    const objName = name.toUpperCase();
    const objType = objectType.toUpperCase();

    const query = `SELECT OBJNAME, OBJTYPE, OBJATTRIBUTE, OBJTEXT, OBJOWNER, OBJSIZE, OBJCREATED, LAST_CHANGED_TIMESTAMP, LAST_USED_TIMESTAMP FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}', OBJECT_NAME => '${objName}')) FETCH FIRST 1 ROW ONLY`;

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    let result: GetObjectInfoOutput;
    if (rows.length === 0) {
      result = { exists: false, library: lib, name: objName, objectType: objType };
    } else {
      const r = rows[0];
      result = {
        exists: true,
        library: lib,
        name: String(r['OBJNAME'] ?? ''),
        objectType: String(r['OBJTYPE'] ?? ''),
        attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : '',
        description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : '',
        owner: r['OBJOWNER'] != null ? String(r['OBJOWNER']) : '',
        size: r['OBJSIZE'] != null ? Number(r['OBJSIZE']) : null,
        createTime: r['OBJCREATED'] != null ? String(r['OBJCREATED']) : null,
        lastModifiedTime: r['LAST_CHANGED_TIMESTAMP'] != null ? String(r['LAST_CHANGED_TIMESTAMP']) : null,
        lastUsedTime: r['LAST_USED_TIMESTAMP'] != null ? String(r['LAST_USED_TIMESTAMP']) : null,
      };
    }

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetObjectInfoInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Getting object info for ${options.input.library}/${options.input.name}` };
  }
}
