export interface GetSourceMemberInput {
  library: string;
  spf: string;
  member: string;
}

export interface GetSourceMemberOutput {
  content: string;
  lines: number;
  memberType: string;
  library: string;
  spf: string;
  member: string;
}

export interface ListSourceMembersInput {
  library: string;
  spf: string;
  filter?: string;
}

export interface MemberInfo {
  name: string;
  type: string;
  description: string;
  lastModified: string | null;
  lines: number | null;
}

export interface ListSourceMembersOutput {
  library: string;
  spf: string;
  members: MemberInfo[];
  total: number;
}

// Phase 2 — IFS + Browsing

export interface ListSourceFilesInput {
  library: string;
}

export interface SourceFileInfo {
  name: string;
  description: string;
  memberCount?: number;
}

export interface ListSourceFilesOutput {
  library: string;
  files: SourceFileInfo[];
  total: number;
}

export interface GetIfsFileInput {
  path: string;
}

export interface GetIfsFileOutput {
  path: string;
  content: string;
  size: number;
}

export interface ListIfsDirectoryInput {
  path: string;
}

export interface IfsEntry {
  name: string;
  type: 'directory' | 'streamfile';
  path: string;
  size?: number;
  lastModified?: string | null;
  owner?: string;
}

export interface ListIfsDirectoryOutput {
  path: string;
  entries: IfsEntry[];
  total: number;
}

export interface ConnectionStatusOutput {
  connected: boolean;
  host?: string;
  user?: string;
  port?: number;
  connectionName?: string;
}

// Phase 3 — Query & Diagnostics

export interface RunSqlInput {
  query: string;
  maxRows?: number;
}

export interface RunSqlOutput {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
}

export interface GetJobLogInput {
  job?: string;
}

export interface JobMessage {
  id: string;
  text: string;
  severity?: number;
  type?: string;
}

export interface GetJobLogOutput {
  messages: JobMessage[];
  total: number;
}

export interface RunClCommandInput {
  command: string;
}

export interface RunClCommandOutput {
  output: string;
  stderr?: string;
  exitCode: number;
}
