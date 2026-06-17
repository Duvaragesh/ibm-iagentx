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
  /** How the content was decoded: ccsid-NNN, base64-binary, utf-8-fallback */
  encoding: string;
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
  osVersion?: string;
}

export interface RunSqlInput {
  query: string;
  maxRows?: number;
  offset?: number;
}

export interface RunSqlOutput {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  offset: number;
  hasMore: boolean;
}

export interface GetJobLogInput {
  job?: string;
  minSeverity?: number;
  messageType?: string;
  maxMessages?: number;
  includeTimestamp?: boolean;
}

export interface JobMessage {
  id: string;
  text: string;
  secondLevelText?: string;
  severity?: number;
  type?: string;
  sendTime?: string;
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

export interface GetSpoolFileInput {
  job: string;
  splfname: string;
  splfnbr?: number;
  startLine?: number;
  lineCount?: number;
}

export interface GetSpoolFileOutput {
  job: string;
  splfname: string;
  splfnbr: number;
  content: string;
  startLine: number;
  returnedLines: number;
  totalLines: number;
}

export interface FindJobsInput {
  jobname: string;
  username?: string;
  status?: 'ACTIVE' | 'OUTQ' | 'ALL';
  date_from?: string;
  date_to?: string;
  subsystem?: string;
}

export interface JobInfo {
  job_number: string;
  job_user: string;
  job_name: string;
  status: 'ACTIVE' | 'ENDED';
  end_time: string | null;
  completion_code: number | null;
  subsystem: string | null;
}

export interface FindJobsOutput {
  jobs: JobInfo[];
  total: number;
}

// Object catalog tools

export interface ListObjectsInput {
  library: string;
  objectType?: string;
  nameFilter?: string;
}

export interface ObjectInfo {
  name: string;
  type: string;
  attribute: string;
  description: string;
  owner: string;
  size: number | null;
  lastModified: string | null;
}

export interface ListObjectsOutput {
  library: string;
  objectType: string;
  objects: ObjectInfo[];
  total: number;
}

export interface GetObjectInfoInput {
  library: string;
  name: string;
  objectType: string;
}

export interface GetObjectInfoOutput {
  exists: boolean;
  library: string;
  name: string;
  objectType: string;
  attribute?: string;
  description?: string;
  owner?: string;
  size?: number | null;
  createTime?: string | null;
  lastModifiedTime?: string | null;
  lastUsedTime?: string | null;
}

export interface CheckObjectInput {
  library: string;
  name: string;
  objectType: string;
}

export interface CheckObjectOutput {
  exists: boolean;
  library: string;
  name: string;
  objectType: string;
  attribute?: string;
  description?: string;
}

export interface GetDataAreaInput {
  library: string;
  name: string;
}

export interface GetDataAreaOutput {
  library: string;
  name: string;
  value: string;
  dataType: string;
  length: number;
  description: string;
}

export interface ListSpoolFilesInput {
  job?: string;
  username?: string;
  splfname?: string;
  maxFiles?: number;
}

export interface SpoolFileInfo {
  job: string;
  splfname: string;
  splfnbr: number;
  status: string;
  pages: number | null;
  createTime: string | null;
  outputQueue: string;
  outputQueueLibrary: string;
}

export interface ListSpoolFilesOutput {
  spoolFiles: SpoolFileInfo[];
  total: number;
}

export interface GetFileFieldsInput {
  library: string;
  file: string;
}

export interface FieldInfo {
  name: string;
  type: string;
  length: number;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  default: string | null;
  description: string;
  position: number;
}

export interface GetFileFieldsOutput {
  library: string;
  file: string;
  fields: FieldInfo[];
  total: number;
}

export interface LibraryEntry {
  library: string;
  type: string;
  position: number;
  description: string;
}

export interface GetLibraryListOutput {
  libraries: LibraryEntry[];
  total: number;
}
