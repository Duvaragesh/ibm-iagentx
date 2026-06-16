import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import { parseEditorUri } from '../utils/parseEditorUri.js';

interface UpdateActiveEditorInput {
  content: string;
}

async function applyContentToUri(uri: vscode.Uri, newContent: string): Promise<void> {
  const info = parseEditorUri(uri);

  if ('library' in info) {
    const conn = getConnection();
    await conn.getContent().uploadMemberContent(
      info.library, info.sourceFile, info.member, newContent
    );
  } else if ('ifsPath' in info) {
    const conn = getConnection();
    await conn.getContent().writeStreamfileRaw(info.ifsPath, newContent);
  }

  // Reflect changes in the open VS Code document regardless of scheme
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    doc.lineAt(0).range.start,
    doc.lineAt(doc.lineCount - 1).range.end
  );
  edit.replace(uri, fullRange, newContent);
  await vscode.workspace.applyEdit(edit);

  if (!('library' in info) && !('ifsPath' in info)) {
    await doc.save();
  }
}

export class UpdateActiveEditorTool implements vscode.LanguageModelTool<UpdateActiveEditorInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<UpdateActiveEditorInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({ error: 'No active editor' })),
      ]);
    }

    const uri = editor.document.uri;
    await applyContentToUri(uri, options.input.content);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify({ success: true, uri: uri.toString() }, null, 2)),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateActiveEditorInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: 'Writing updated content to active editor' };
  }
}

export { applyContentToUri };
