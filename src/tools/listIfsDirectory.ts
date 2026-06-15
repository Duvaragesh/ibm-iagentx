import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { ListIfsDirectoryInput, ListIfsDirectoryOutput, IfsEntry } from '../types.js';

export class ListIfsDirectoryTool implements vscode.LanguageModelTool<ListIfsDirectoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListIfsDirectoryInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path } = options.input;
    const connection = getConnection();
    const content = connection.getContent();

    const files = await content.getFileList(path);
    const entries: IfsEntry[] = files.map(f => ({
      name: f.name,
      type: f.type,
      path: f.path,
      size: f.size,
      lastModified: f.modified ? f.modified.toISOString() : null,
      owner: f.owner,
    }));

    const result: ListIfsDirectoryOutput = { path, entries, total: entries.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListIfsDirectoryInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Listing IFS directory ${options.input.path}` };
  }
}
