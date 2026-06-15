import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { getConnection } from '../ibmiConnection.js';
import type { GetSourceMemberInput, GetSourceMemberOutput } from '../types.js';

export class GetSourceMemberTool implements vscode.LanguageModelTool<GetSourceMemberInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetSourceMemberInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, spf, member } = options.input;
    const lib = library.toUpperCase();
    const file = spf.toUpperCase();
    const mem = member.toUpperCase();

    const connection = getConnection();
    const content = connection.getContent();

    // Resolve member type via getMemberList (single member lookup)
    const members = await content.getMemberList({ library: lib, sourceFile: file, members: mem });
    const memberMeta = members.find(m => m.name.toUpperCase() === mem);
    const memberType = memberMeta?.extension ?? '';

    // downloadMemberContent downloads to a temp local file and returns its path
    const localPath = await content.downloadMemberContent(lib, file, mem);
    const text = await fs.readFile(localPath, 'utf-8');
    const lineCount = text.split('\n').length;

    const result: GetSourceMemberOutput = {
      library: lib,
      spf: file,
      member: mem,
      memberType,
      content: text,
      lines: lineCount,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetSourceMemberInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const { library, spf, member } = options.input;
    return {
      invocationMessage: `Reading ${library}/${spf}(${member}) from IBM i`,
    };
  }
}
