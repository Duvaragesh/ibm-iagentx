import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { GetIfsFileInput, GetIfsFileOutput } from '../types.js';

export class GetIfsFileTool implements vscode.LanguageModelTool<GetIfsFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetIfsFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { path } = options.input;
    const connection = getConnection();
    const content = connection.getContent();

    const buf = await content.downloadStreamfileRaw(path);
    const text = buf.toString('utf-8');

    const result: GetIfsFileOutput = { path, content: text, size: buf.length };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetIfsFileInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Reading IFS file ${options.input.path}` };
  }
}
