import * as vscode from 'vscode';

export type MemberEditorInfo = {
  scheme: 'member';
  library: string;
  sourceFile: string;
  member: string;
  type: string;
};

export type StreamfileEditorInfo = {
  scheme: 'streamfile';
  ifsPath: string;
};

export type LocalEditorInfo = {
  scheme: string;
  filePath: string;
};

export type EditorInfo = MemberEditorInfo | StreamfileEditorInfo | LocalEditorInfo;

export function parseEditorUri(uri: vscode.Uri): EditorInfo {
  if (uri.scheme === 'member') {
    const parts = uri.path.split('/').filter(Boolean);
    if (parts.length < 3) {
      throw new Error(`Unexpected member URI path: ${uri.path}`);
    }
    const [library, sourceFile, memberAndType] = parts;
    const dot = memberAndType.lastIndexOf('.');
    return {
      scheme: 'member',
      library,
      sourceFile,
      member: dot > 0 ? memberAndType.slice(0, dot) : memberAndType,
      type: dot > 0 ? memberAndType.slice(dot + 1) : '',
    };
  }
  if (uri.scheme === 'streamfile') {
    return { scheme: 'streamfile', ifsPath: uri.path };
  }
  return { scheme: uri.scheme, filePath: uri.fsPath };
}
