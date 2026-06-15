import * as vscode from 'vscode';
import { getConnection } from '../ibmiConnection.js';
import type { ListSourceMembersInput, ListSourceMembersOutput, MemberInfo } from '../types.js';

export class ListSourceMembersTool implements vscode.LanguageModelTool<ListSourceMembersInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListSourceMembersInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { library, spf, filter } = options.input;
    const lib = library.toUpperCase();
    const file = spf.toUpperCase();

    const connection = getConnection();
    const content = connection.getContent();

    const members = await content.getMemberList({
      library: lib,
      sourceFile: file,
      members: filter ? filter.toUpperCase() : undefined,
    });

    const memberInfos: MemberInfo[] = members.map(m => ({
      name: m.name,
      type: m.extension ?? '',
      description: m.text ?? '',
      lastModified: m.changed ? m.changed.toISOString() : null,
      lines: m.lines ?? null,
    }));

    const result: ListSourceMembersOutput = {
      library: lib,
      spf: file,
      members: memberInfos,
      total: memberInfos.length,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListSourceMembersInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const { library, spf, filter } = options.input;
    const label = filter ? `${library}/${spf} (filter: ${filter})` : `${library}/${spf}`;
    return {
      invocationMessage: `Listing members in ${label}`,
    };
  }
}
