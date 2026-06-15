import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { ListSourceFilesInput, ListSourceFilesOutput, SourceFileInfo } from '../types.js';

export class ListSourceFilesTool implements vscode.LanguageModelTool<ListSourceFilesInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListSourceFilesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const lib = options.input.library.toUpperCase();
    const connection = getConnection();
    const content = connection.getContent();

    const objects = await content.getObjectList({ library: lib, types: ['*FILE'] });
    const sourceFiles = objects.filter(o => o.sourceFile === true);

    const files: SourceFileInfo[] = sourceFiles.map(o => ({
      name: o.name,
      description: o.text ?? '',
    }));

    const result: ListSourceFilesOutput = { library: lib, files, total: files.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListSourceFilesInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Listing source physical files in ${options.input.library}` };
  }
}
