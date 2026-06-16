import * as vscode from 'vscode';
import { parseEditorUri } from '../utils/parseEditorUri.js';

export class ListOpenEditorsTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const activeEditor = vscode.window.activeTextEditor;
    const editors = vscode.window.visibleTextEditors.map(editor => {
      const uri = editor.document.uri;
      const info = parseEditorUri(uri);
      return {
        ...info,
        uri: uri.toString(),
        isDirty: editor.document.isDirty,
        lineCount: editor.document.lineCount,
        isActive: editor === activeEditor,
      };
    });

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(editors, null, 2)),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: 'Listing open editors in VS Code' };
  }
}
