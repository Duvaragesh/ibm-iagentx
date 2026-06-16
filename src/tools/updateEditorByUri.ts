import * as vscode from 'vscode';
import { applyContentToUri } from './updateActiveEditor.js';

interface UpdateEditorByUriInput {
  uri: string;
  content: string;
}

export class UpdateEditorByUriTool implements vscode.LanguageModelTool<UpdateEditorByUriInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<UpdateEditorByUriInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { uri: uriString, content } = options.input;
    const uri = vscode.Uri.parse(uriString);

    await applyContentToUri(uri, content);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify({ success: true, uri: uriString }, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateEditorByUriInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `Writing updated content to ${options.input.uri}` };
  }
}
