import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { ListObjectsInput, ListObjectsOutput } from '../types.js';

export class ListObjectsTool implements vscode.LanguageModelTool<ListObjectsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListObjectsInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, objectType, nameFilter } = options.input;
    const lib = library.toUpperCase();
    const objType = objectType ? objectType.toUpperCase() : '*ALL';

    let nameClause = '';
    if (nameFilter) {
      const pattern = nameFilter.toUpperCase().endsWith('*')
        ? nameFilter.toUpperCase().slice(0, -1) + '%'
        : nameFilter.toUpperCase();
      nameClause = ` WHERE OBJNAME LIKE '${pattern}'`;
    }

    const query = `SELECT OBJNAME, OBJTYPE, OBJATTRIBUTE, OBJTEXT, OBJOWNER, OBJSIZE, LAST_USED_TIMESTAMP FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}'))${nameClause} ORDER BY OBJNAME FETCH FIRST 500 ROWS ONLY`;

    const rows = await getConnection().runSQL(query) as Record<string, unknown>[];
    const objects = rows.map(r => ({
      name: String(r['OBJNAME'] ?? ''),
      type: String(r['OBJTYPE'] ?? ''),
      attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : '',
      description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : '',
      owner: r['OBJOWNER'] != null ? String(r['OBJOWNER']) : '',
      size: r['OBJSIZE'] != null ? Number(r['OBJSIZE']) : null,
      lastModified: r['LAST_USED_TIMESTAMP'] != null ? String(r['LAST_USED_TIMESTAMP']) : null,
    }));

    const result: ListObjectsOutput = { library: lib, objectType: objType, objects, total: objects.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListObjectsInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const type = options.input.objectType ?? '*ALL';
    return { invocationMessage: `Listing ${type} objects in ${options.input.library}` };
  }
}
