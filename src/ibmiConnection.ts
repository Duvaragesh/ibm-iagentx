import * as vscode from 'vscode';
import type { CodeForIBMi } from '@halcyontech/vscode-ibmi-types';

export type IBMiConnection = ReturnType<
  NonNullable<CodeForIBMi['instance']>['getConnection']
>;

export function getConnection(): NonNullable<IBMiConnection> {
  const ext = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
  if (!ext) {
    throw new Error(
      'Code for IBM i extension is not installed. Install "halcyontechltd.code-for-ibmi" first.'
    );
  }
  if (!ext.isActive) {
    throw new Error(
      'Code for IBM i extension is not active. Connect to an IBM i system first.'
    );
  }
  const connection = ext.exports.instance.getConnection();
  if (!connection) {
    throw new Error(
      'No active IBM i connection. Use Code for IBM i (Ctrl+Shift+P → IBM i: Connect) to connect first.'
    );
  }
  return connection;
}
