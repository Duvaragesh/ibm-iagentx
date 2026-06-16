import * as vscode from 'vscode';
import { parseEditorUri } from '../utils/parseEditorUri.js';

export class GetActiveEditorTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({ error: 'No active editor' })),
      ]);
    }

    const uri = editor.document.uri;
    const doc = await vscode.workspace.openTextDocument(uri);
    const content = doc.getText();
    const info = parseEditorUri(uri);

    const result: Record<string, unknown> = {
      ...info,
      content,
      isDirty: editor.document.isDirty,
      lineCount: editor.document.lineCount,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: 'Reading active editor content from VS Code' };
  }
}
