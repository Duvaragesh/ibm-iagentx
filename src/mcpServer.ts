import * as http from 'http';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { getConnection } from './ibmiConnection.js';
import { parseEditorUri } from './utils/parseEditorUri.js';
import { readIfsAsText } from './utils/ifsRead.js';
import { castUtf8 } from './utils/ccsidCast.js';

// vscode.window.activeTextEditor goes undefined whenever focus leaves the editor
// (e.g. the user clicks into the Claude Code terminal to type a prompt).
// We track the last editor that was active so MCP tools can still reach it.
let lastActiveEditor: vscode.TextEditor | undefined;

export function setLastActiveEditor(editor: vscode.TextEditor | undefined): void {
  if (editor) { lastActiveEditor = editor; }
}

function getActiveEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor ?? lastActiveEditor;
}

// If the AI passed literal \r\n or \n escape sequences instead of actual newlines,
// normalise them so the file is written with real line breaks.
function normaliseLineEndings(content: string): string {
  if (!content.includes('\n') && content.includes('\\n')) {
    return content.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
  }
  return content;
}

// Compute the minimal contiguous replacement needed between the current document
// and newContent. Trimming unchanged lines from the top and bottom means Code for
// IBM i's file-system provider only sees (and re-dates) the lines that truly changed.
function minimalReplacement(
  doc: vscode.TextDocument,
  newLines: string[]
): { range: vscode.Range; text: string } | null {
  const oldCount = doc.lineCount;
  const newCount = newLines.length;

  let start = 0;
  while (start < oldCount && start < newCount && doc.lineAt(start).text === newLines[start]) {
    start++;
  }
  if (start === oldCount && start === newCount) {
    return null; // identical — nothing to do
  }

  let endOld = oldCount - 1;
  let endNew = newCount - 1;
  while (endOld >= start && endNew >= start && doc.lineAt(endOld).text === newLines[endNew]) {
    endOld--;
    endNew--;
  }

  const rangeStart = doc.lineAt(start).range.start;
  const rangeEnd   = doc.lineAt(endOld).range.end;
  const text       = newLines.slice(start, endNew + 1).join('\n');
  return { range: new vscode.Range(rangeStart, rangeEnd), text };
}

async function applyEditorUpdate(uri: vscode.Uri, newContent: string): Promise<void> {
  newContent = normaliseLineEndings(newContent);
  const info = parseEditorUri(uri);

  const doc = await vscode.workspace.openTextDocument(uri);

  // Split on \n but keep \r if present (CRLF lines stay intact for comparison)
  const newLines = newContent.split('\n');

  const patch = minimalReplacement(doc, newLines);
  if (patch) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, patch.range, patch.text);
    await vscode.workspace.applyEdit(edit);
  }

  if ('ifsPath' in info) {
    // IFS files have no SRCDAT concept — write directly via the streamfile API.
    const conn = getConnection();
    await conn.getContent().writeStreamfileRaw(info.ifsPath, newContent);
  } else {
    // For IBM i members and local files, save through VS Code's file-system provider.
    // Code for IBM i's member: provider compares lines on save and only updates
    // SRCDAT for lines that actually changed, so we must NOT call uploadMemberContent
    // (which rewrites the whole member and resets every record's date).
    await doc.save();
  }
}

const TOOLS = [
  {
    name: 'ibmi_get_source_member',
    description: 'Retrieves the full source code of a member from an IBM i source physical file (QCLLESRC, QRPGLESRC, QSQLSRC, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name (e.g. MYLIB, DK)' },
        spf: { type: 'string', description: 'Source physical file name (e.g. QCLLESRC, QRPGLESRC)' },
        member: { type: 'string', description: 'Member name (e.g. BATCHFTP)' },
      },
      required: ['library', 'spf', 'member'],
    },
  },
  {
    name: 'ibmi_list_source_members',
    description: 'Lists all members in an IBM i source physical file with their type (CLLE, RPGLE, etc.), text description, and last-modified date.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name (e.g. MYLIB)' },
        spf: { type: 'string', description: 'Source physical file name (e.g. QCLLESRC)' },
        filter: { type: 'string', description: 'Optional member name filter with * wildcard (e.g. BATCH*)' },
      },
      required: ['library', 'spf'],
    },
  },
  {
    name: 'ibmi_list_source_files',
    description: 'Lists all source physical files (SPFs) in an IBM i library.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name (e.g. MYLIB, DK)' },
      },
      required: ['library'],
    },
  },
  {
    name: 'ibmi_get_ifs_file',
    description: 'Reads the content of a file from the IBM i IFS (Integrated File System).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute IFS path (e.g. /home/MYUSER/scripts/deploy.sh)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'ibmi_list_ifs_directory',
    description: 'Lists the contents of an IFS directory, showing files and subdirectories with size and modification date.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute IFS directory path (e.g. /home/MYUSER)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'ibmi_connection_status',
    description: 'Returns the current IBM i connection status including OS version. Use this to check whether a connection is active before running other tools. ' +
      'Available tools: ibmi_connection_status, ibmi_get_active_editor, ibmi_list_open_editors, ibmi_update_active_editor, ' +
      'ibmi_update_editor_by_uri, ibmi_replace_in_active_editor, ibmi_get_source_member, ibmi_list_source_members, ' +
      'ibmi_list_source_files, ibmi_get_ifs_file, ibmi_list_ifs_directory, ibmi_run_sql, ibmi_get_job_log, ibmi_run_cl_command, ' +
      'ibmi_get_spool_file, ibmi_find_jobs, ibmi_list_objects, ibmi_get_object_info, ibmi_check_object, ibmi_get_data_area, ' +
      'ibmi_list_spool_files, ibmi_get_file_fields, ibmi_get_library_list. ' +
      'The first six (ibmi_get_active_editor, ibmi_list_open_editors, ibmi_update_active_editor, ibmi_update_editor_by_uri, ' +
      'ibmi_replace_in_active_editor) work without an IBM i connection; all others require one. ' +
      'Fetch all needed tool schemas in a single ToolSearch call upfront rather than sequentially.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ibmi_run_sql',
    description: 'Runs a read-only SQL SELECT query against DB2 for i and returns the result rows. Only SELECT, WITH (CTEs), and VALUES statements are permitted. NOTE: on V7R6+ table functions require the explicit TABLE() wrapper — use FROM TABLE(QSYS2.IFS_READ(...)) not FROM QSYS2.IFS_READ(...). The tool auto-retries with the wrapper on SQL0104, but writing it correctly avoids the extra round-trip. Use offset for pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT statement to execute' },
        maxRows: { type: 'number', description: 'Maximum rows to return (default 100, max 1000)' },
        offset: { type: 'number', description: 'Number of rows to skip for pagination (default 0). Check hasMore in the response to determine if more rows exist.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ibmi_get_job_log',
    description: 'Retrieves job log messages (up to 100 by default, max 500). Returns structured message objects including second-level diagnostic text and optional timestamps. Defaults to the current job; pass a qualified job name (NUMBER/USER/NAME) to query another job.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Qualified job name in NUMBER/USER/NAME format, or omit for the current job' },
        minSeverity: { type: 'number', description: 'Only return messages with severity >= this value (e.g. 30 for warnings, 40 for errors)' },
        messageType: { type: 'string', description: 'Filter by message type: *ESCAPE, *DIAG, *COMP, *INFO, *NOTIFY, *REQUEST, *STATUS' },
        maxMessages: { type: 'number', description: 'Maximum messages to return (default 100, max 500)' },
        includeTimestamp: { type: 'boolean', description: 'When true, include sendTime (ISO timestamp) in each message' },
      },
      required: [],
    },
  },
  {
    name: 'ibmi_run_cl_command',
    description: 'Runs a read-only CL command (DSP*, WRK*, CHK*, RTV*, PRT*, DMP*, LST*, QRY* prefixes only) and returns its output. CPYSPLF is also allowed when TOFILE(*TOSTMF) and a destination path under /tmp/ are specified.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'CL command to run (e.g. DSPFD FILE(MYLIB/QCLLESRC))' },
      },
      required: ['command'],
    },
  },
  {
    name: 'ibmi_get_spool_file',
    description: 'Retrieves the text content of a spool file from an IBM i job. Use this to read QPJOBLOG or other spool files. Supports line range for large files — always returns totalLines so you can paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Qualified job name in NUMBER/USER/NAME format, e.g. 899342/ADMIN/PPECPRC' },
        splfname: { type: 'string', description: 'Spool file name, e.g. QPJOBLOG' },
        splfnbr: { type: 'number', description: 'Spool file number. If omitted, returns the last/most recent matching spool file' },
        startLine: { type: 'number', description: 'First line to return (1-based, default 1)' },
        lineCount: { type: 'number', description: 'Number of lines to return. If omitted, returns all lines from startLine' },
      },
      required: ['job', 'splfname'],
    },
  },
  {
    name: 'ibmi_find_jobs',
    description: 'Searches for IBM i jobs by name pattern, user, and status — active or recently ended. Supports trailing wildcards, e.g. PPLPMENV*.',
    inputSchema: {
      type: 'object',
      properties: {
        jobname: { type: 'string', description: 'Job name to search. Supports trailing wildcard, e.g. PPLPMENV*' },
        username: { type: 'string', description: 'Filter by IBM i user profile, e.g. ADMIN' },
        status: { type: 'string', enum: ['ACTIVE', 'OUTQ', 'ALL'], description: 'ACTIVE — active jobs only; OUTQ — ended jobs; ALL — both (default)' },
        date_from: { type: 'string', description: 'Start date filter in YYYY-MM-DD format (applies to ended jobs)' },
        date_to: { type: 'string', description: 'End date filter in YYYY-MM-DD format (applies to ended jobs)' },
        subsystem: { type: 'string', description: 'Filter active jobs by subsystem name, e.g. QBATCH, QINTER' },
      },
      required: ['jobname'],
    },
  },
  {
    name: 'ibmi_list_objects',
    description: 'Lists objects in an IBM i library filtered by type and/or name pattern. Returns up to 500 objects. Use nameFilter with a trailing * wildcard (e.g. BAT*) for large libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name (e.g. MYLIB, QGPL)' },
        objectType: { type: 'string', description: 'Object type filter: *FILE, *PGM, *SRVPGM, *CMD, *DTAARA, *DTAQ, *MSGF, *LIB, *ALL (default *ALL)' },
        nameFilter: { type: 'string', description: 'Name filter with optional trailing wildcard, e.g. BAT* or MYPGM' },
      },
      required: ['library'],
    },
  },
  {
    name: 'ibmi_get_object_info',
    description: 'Returns detailed attributes of a single IBM i object (type, owner, size, creation/modification/last-used timestamps). Returns exists:false when the object is not found — never throws.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name' },
        name: { type: 'string', description: 'Object name' },
        objectType: { type: 'string', description: 'Object type, e.g. *FILE, *PGM, *SRVPGM, *CMD, *DTAARA' },
      },
      required: ['library', 'name', 'objectType'],
    },
  },
  {
    name: 'ibmi_check_object',
    description: 'Checks whether an IBM i object exists. Lightweight existence check — returns exists:true/false without throwing. Use before operations that require the object to exist.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library name' },
        name: { type: 'string', description: 'Object name' },
        objectType: { type: 'string', description: 'Object type, e.g. *FILE, *PGM, *DTAARA' },
      },
      required: ['library', 'name', 'objectType'],
    },
  },
  {
    name: 'ibmi_get_data_area',
    description: 'Reads the current value and attributes of an IBM i data area (*DTAARA). Returns the value as a string regardless of type (*CHAR, *DEC, *LGL).',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library containing the data area' },
        name: { type: 'string', description: 'Data area name' },
      },
      required: ['library', 'name'],
    },
  },
  {
    name: 'ibmi_list_spool_files',
    description: 'Lists spool file metadata for a job or user — without fetching content. Use this to discover available spool files before calling ibmi_get_spool_file.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Qualified job name in NUMBER/USER/NAME format. If omitted, lists for all jobs.' },
        username: { type: 'string', description: 'Filter by user profile (used when job is omitted)' },
        splfname: { type: 'string', description: 'Filter by spool file name, e.g. QPJOBLOG' },
        maxFiles: { type: 'number', description: 'Maximum spool files to return (default 50, max 200)' },
      },
      required: [],
    },
  },
  {
    name: 'ibmi_get_file_fields',
    description: 'Returns field definitions (column metadata) for an IBM i physical or logical file. Includes field name, SQL type, length, precision/scale, nullability, and IBM i text description.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string', description: 'Library containing the file' },
        file: { type: 'string', description: 'File name (physical or logical)' },
      },
      required: ['library', 'file'],
    },
  },
  {
    name: 'ibmi_get_library_list',
    description: 'Returns the current library list for the IBM i connection, ordered by position. Includes system (*SYS), product (*PROD), current (*CUR), and user (*USR) libraries.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ibmi_get_active_editor',
    description: 'Returns the content and metadata of the currently focused VS Code editor. Works with IBM i member: URIs (source members) and streamfile: URIs (IFS files) opened via Code for i, as well as ordinary local files. ' +
      'After reading, use ibmi_replace_in_active_editor for small or single-location changes; ' +
      'use ibmi_update_active_editor only when multiple non-contiguous lines all change at once.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ibmi_list_open_editors',
    description: 'Lists all currently visible VS Code editor tabs with metadata (URI scheme, library/source-file/member for IBM i members, IFS path for streamfiles, local file path for others). Does not return file content — use ibmi_get_active_editor or call ibmi_update_editor_by_uri with the returned URI to read/write a specific tab.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ibmi_update_active_editor',
    description: 'Replaces the FULL content of the currently active VS Code editor and saves it back to IBM i (member or IFS file) or to disk for local files. ' +
      'Use this only when multiple non-contiguous lines all need to change at once — for a single contiguous change, prefer ibmi_replace_in_active_editor which does not require sending the entire file. ' +
      'IMPORTANT: the content parameter must contain actual newline characters (\\n or \\r\\n), not escaped sequences like \\\\n or \\\\r\\\\n. Preserve the exact line structure of the original source.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The complete new source content to write. Must use real newline characters, not escaped \\n sequences.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'ibmi_update_editor_by_uri',
    description: 'Replaces the full content of a specific open VS Code editor (identified by its URI string from ibmi_list_open_editors) and saves it back to IBM i or to disk. IMPORTANT: the content parameter must contain actual newline characters (\\n or \\r\\n), not escaped sequences like \\\\n or \\\\r\\\\n. Preserve the exact line structure of the original source.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The full URI string of the editor to update (from ibmi_list_open_editors)' },
        content: { type: 'string', description: 'The complete new source content to write. Must use real newline characters, not escaped \\n sequences.' },
      },
      required: ['uri', 'content'],
    },
  },
  {
    name: 'ibmi_replace_in_active_editor',
    description:
      'Makes a targeted find-and-replace in the currently active VS Code editor without ' +
      'requiring the full file content. Finds the first occurrence of oldText (which must be ' +
      'unique in the document), replaces it with newText, and saves. ' +
      'PREFER THIS over ibmi_update_active_editor whenever only one contiguous block of text ' +
      'is changing — it avoids sending the whole file and is SRCDAT-safe. ' +
      'Returns the 1-based line number where the replacement was made. ' +
      'Error if oldText is not found or appears more than once.',
    inputSchema: {
      type: 'object',
      properties: {
        oldText: { type: 'string', description: 'Exact text to find (must be unique in the file). Use real newlines (\\n) for multi-line spans.' },
        newText: { type: 'string', description: 'Replacement text. Use real newline characters (\\n), not escaped \\\\n sequences.' },
      },
      required: ['oldText', 'newText'],
    },
  },
];

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  // ibmi_connection_status must not call getConnection() — it reports whether one exists
  if (name === 'ibmi_connection_status') {
    const ext = vscode.extensions.getExtension('halcyontechltd.code-for-ibmi');
    if (!ext?.isActive) {
      return { content: [{ type: 'text', text: JSON.stringify({ connected: false }, null, 2) }] };
    }
    const conn = ext.exports.instance.getConnection();
    if (!conn) {
      return { content: [{ type: 'text', text: JSON.stringify({ connected: false }, null, 2) }] };
    }
    let osVersion: string | undefined;
    try {
      const rows = await conn.runSQL(
        `SELECT OS_RELEASE FROM TABLE(QSYS2.SYSTEM_STATUS_INFO()) FETCH FIRST 1 ROW ONLY`
      ) as Record<string, unknown>[];
      if (rows.length > 0 && rows[0]['OS_RELEASE'] != null) {
        osVersion = String(rows[0]['OS_RELEASE']);
      }
    } catch { /* optional — skip on unsupported platforms */ }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        connected: true,
        host: conn.currentHost,
        user: conn.currentUser,
        port: conn.currentPort,
        connectionName: conn.currentConnectionName,
        osVersion,
      }, null, 2) }],
    };
  }

  // These tools only use the VS Code editor API — they don't need an IBM i connection.
  const VSCODE_ONLY_TOOLS = new Set([
    'ibmi_get_active_editor',
    'ibmi_list_open_editors',
    'ibmi_update_active_editor',
    'ibmi_update_editor_by_uri',
    'ibmi_replace_in_active_editor',
  ]);

  if (!VSCODE_ONLY_TOOLS.has(name)) {
    // Eagerly validate the connection for all IBM i tools so they fail fast with a clear error.
    getConnection();
  }

  const getConn = () => getConnection();
  const getContent = () => getConn().getContent();

  if (name === 'ibmi_get_source_member') {
    const lib = String(args.library).toUpperCase();
    const file = String(args.spf).toUpperCase();
    const mem = String(args.member).toUpperCase();
    const members = await getContent().getMemberList({ library: lib, sourceFile: file, members: mem });
    const meta = members.find(m => m.name.toUpperCase() === mem);
    const localPath = await getContent().downloadMemberContent(lib, file, mem);
    const text = await fs.readFile(localPath, 'utf-8');
    return {
      content: [{ type: 'text', text: JSON.stringify({
        library: lib, spf: file, member: mem,
        memberType: meta?.extension ?? '',
        content: text,
        lines: text.split('\n').length,
      }, null, 2) }],
    };
  }

  if (name === 'ibmi_list_source_members') {
    const lib = String(args.library).toUpperCase();
    const file = String(args.spf).toUpperCase();
    const filter = args.filter ? String(args.filter).toUpperCase() : undefined;
    const members = await getContent().getMemberList({ library: lib, sourceFile: file, members: filter });
    const memberInfos = members.map(m => ({
      name: m.name, type: m.extension ?? '', description: m.text ?? '',
      lastModified: m.changed ? m.changed.toISOString() : null,
      lines: m.lines ?? null,
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ library: lib, spf: file, members: memberInfos, total: memberInfos.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_list_source_files') {
    const lib = String(args.library).toUpperCase();
    const objects = await getContent().getObjectList({ library: lib, types: ['*FILE'] });
    const sourceFiles = objects.filter((o: { sourceFile?: boolean }) => o.sourceFile === true);
    const files = sourceFiles.map((o: { name: string; text?: string }) => ({
      name: o.name,
      description: o.text ?? '',
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ library: lib, files, total: files.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_get_ifs_file') {
    const ifsPath = String(args.path);
    const { text, encoding } = await readIfsAsText(getConn(), ifsPath);
    return {
      content: [{ type: 'text', text: JSON.stringify({ path: ifsPath, content: text, size: Buffer.byteLength(text, 'utf-8'), encoding }, null, 2) }],
    };
  }

  if (name === 'ibmi_list_ifs_directory') {
    const ifsPath = String(args.path);
    const files = await getContent().getFileList(ifsPath);
    const entries = files.map((f: { name: string; type: string; path: string; size?: number; modified?: Date; owner?: string }) => ({
      name: f.name,
      type: f.type,
      path: f.path,
      size: f.size,
      lastModified: f.modified ? f.modified.toISOString() : null,
      owner: f.owner,
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ path: ifsPath, entries, total: entries.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_run_sql') {
    const query = String(args.query);
    const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
    const defaultMax: number = cfg.get('sqlMaxRows') ?? 100;
    const maxRows = Math.min(Number(args.maxRows ?? defaultMax), 1000);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    const trimmed = query.trim().toUpperCase();
    if (!/^(SELECT|WITH|VALUES)\b/.test(trimmed)) {
      throw new Error('Only SELECT statements are allowed. DML and DDL are not permitted.');
    }
    let rows: Record<string, unknown>[];
    try {
      rows = await getConn().runSQL(query) as Record<string, unknown>[];
    } catch (e) {
      // V7R6+ requires TABLE() wrapper for table functions — auto-retry once
      if (/SQL0104/i.test(String(e))) {
        const rewritten = query.replace(
          /\b(FROM|JOIN)\s+(?!TABLE\s*\()([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*\s*\()/gi,
          (_m: string, kw: string, fn: string) => `${kw} TABLE(${fn}`
        );
        if (rewritten !== query) {
          rows = await getConn().runSQL(rewritten) as Record<string, unknown>[];
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }
    const paged = rows.slice(offset, offset + maxRows + 1);
    const hasMore = paged.length > maxRows;
    const sliced = paged.slice(0, maxRows);
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
    return {
      content: [{ type: 'text', text: JSON.stringify({ rows: sliced, columns, rowCount: sliced.length, offset, hasMore }, null, 2) }],
    };
  }

  if (name === 'ibmi_get_job_log') {
    const jobArg = args.job ? String(args.job) : undefined;
    const minSeverityArg = args.minSeverity !== undefined && args.minSeverity !== null ? Number(args.minSeverity) : undefined;
    const messageTypeArg = args.messageType ? String(args.messageType).toUpperCase() : undefined;
    const fetchLimit = Math.min(args.maxMessages != null ? Number(args.maxMessages) : 100, 500);
    const includeTimestamp = args.includeTimestamp === true;
    const conditions: string[] = [];
    if (minSeverityArg !== undefined) { conditions.push(`SEVERITY >= ${minSeverityArg}`); }
    if (messageTypeArg) { conditions.push(`MESSAGE_TYPE = '${messageTypeArg}'`); }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const timestampCol = includeTimestamp ? ', MESSAGE_TIMESTAMP' : '';
    let query: string;
    if (jobArg) {
      const parts = jobArg.split('/');
      if (parts.length !== 3) {
        throw new Error('job must be in NUMBER/USER/NAME format');
      }
      const [number, user, jobName] = parts;
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, SEVERITY, MESSAGE_TYPE${timestampCol} FROM TABLE(QSYS2.JOBLOG_INFO('${number}/${user}/${jobName}'))${whereClause} ORDER BY ORDINAL_POSITION DESC FETCH FIRST ${fetchLimit} ROWS ONLY`;
    } else {
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, SEVERITY, MESSAGE_TYPE${timestampCol} FROM TABLE(QSYS2.JOBLOG_INFO('*'))${whereClause} ORDER BY ORDINAL_POSITION DESC FETCH FIRST ${fetchLimit} ROWS ONLY`;
    }
    let messages: { id: string; text: string; secondLevelText?: string; severity?: number; type?: string; sendTime?: string }[];
    try {
      const rows = await getConn().runSQL(query) as Record<string, unknown>[];
      messages = rows.map(r => ({
        id: String(r['MESSAGE_ID'] ?? ''),
        text: String(r['MESSAGE_TEXT'] ?? ''),
        secondLevelText: r['MESSAGE_SECOND_LEVEL_TEXT'] ? String(r['MESSAGE_SECOND_LEVEL_TEXT']) : undefined,
        severity: r['SEVERITY'] != null ? Number(r['SEVERITY']) : undefined,
        type: r['MESSAGE_TYPE'] != null ? String(r['MESSAGE_TYPE']) : undefined,
        sendTime: includeTimestamp && r['MESSAGE_TIMESTAMP'] != null ? String(r['MESSAGE_TIMESTAMP']) : undefined,
      }));
    } catch {
      if (!jobArg) {
        throw new Error('Job log for current job is unavailable');
      }
      const [jobNumber] = jobArg.split('/');
      const tmpPath = `/tmp/iagentx_joblog_${jobNumber}.txt`;
      const cmdResult = await getConn().runCommand({
        command: `CPYSPLF FILE(QPJOBLOG) TOFILE(*TOSTMF) JOB(${jobArg}) TOSTMF('${tmpPath}') STMFOPT(*REPLACE)`,
        environment: 'ile',
      });
      if (cmdResult.code !== 0) {
        messages = [{ id: 'SPOOL', text: 'Job has ended and spool file is no longer available', type: 'SPOOL' }];
      } else {
        const { text } = await readIfsAsText(getConn(), tmpPath);
        await getConn().runCommand({ command: `RMVLNK OBJLNK('${tmpPath}')`, environment: 'ile' }).catch(() => {});
        messages = [{ id: 'SPOOL', text, type: 'SPOOL' }];
      }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ messages, total: messages.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_run_cl_command') {
    const command = String(args.command);
    const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
    const verb = command.trim().toUpperCase().split(/\s+/)[0];
    if (verb === 'CPYSPLF') {
      const tofileMatch = /TOFILE\s*\(\s*\*TOSTMF\s*\)/i.test(command);
      const tostmfMatch = /TOSTMF\s*\(\s*'(\/[^']+)'\s*\)/i.exec(command);
      const validPath = tostmfMatch !== null && tostmfMatch[1].startsWith('/tmp/');
      if (!tofileMatch || !validPath) {
        throw new Error('CPYSPLF is only permitted with TOFILE(*TOSTMF) and a destination path under /tmp/');
      }
    } else {
      const ALLOWED_PREFIXES: string[] = cfg.get('clAllowedPrefixes') ?? ['DSP', 'LST', 'WRK', 'CHK', 'PRT', 'DMP', 'RTV', 'QRY'];
      if (!ALLOWED_PREFIXES.some(p => verb.startsWith(p))) {
        throw new Error(`Command not allowed. Only read-only commands starting with ${ALLOWED_PREFIXES.join(', ')} are permitted.`);
      }
    }
    const result = await getConn().runCommand({ command, environment: 'ile' });
    return {
      content: [{ type: 'text', text: JSON.stringify({
        output: result.stdout ?? '',
        stderr: result.stderr || undefined,
        exitCode: result.code ?? 0,
      }, null, 2) }],
    };
  }

  if (name === 'ibmi_get_spool_file') {
    const job = String(args.job);
    const splfname = String(args.splfname).toUpperCase();
    const splfnbr = args.splfnbr != null ? Number(args.splfnbr) : undefined;
    const parts = job.split('/');
    if (parts.length !== 3) {
      throw new Error('job must be in NUMBER/USER/NAME format, e.g. 123456/MYUSER/QZDASOINIT');
    }
    const [jobNumber] = parts;
    const splfnbrFilter = splfnbr != null ? ` AND SPOOLED_FILE_NUMBER = ${splfnbr}` : '';
    const metaQuery = `SELECT SPOOLED_FILE_NUMBER FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${job}')) WHERE SPOOLED_FILE_NAME = '${splfname}'${splfnbrFilter} ORDER BY SPOOLED_FILE_NUMBER DESC FETCH FIRST 1 ROW ONLY`;
    let metaRows: Record<string, unknown>[];
    try {
      metaRows = await getConn().runSQL(metaQuery) as Record<string, unknown>[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|CPF3307|CPF3330/i.test(msg)) { throw new Error(`Job ${job} not found`); }
      throw e;
    }
    if (metaRows.length === 0) {
      throw new Error(`No spool file ${splfname} found for job ${job}`);
    }
    const resolvedSplfnbr = Number(metaRows[0]['SPOOLED_FILE_NUMBER']);
    const tmpPath = `/tmp/iagentx_${jobNumber}_${splfname}_${resolvedSplfnbr}.txt`;
    // Only include SPLFNBR when the caller provided it — omitting avoids CPD0043
    const splfnbrClause = splfnbr != null ? ` SPLFNBR(${resolvedSplfnbr})` : '';
    const cpySplf = `CPYSPLF FILE(${splfname}) TOFILE(*TOSTMF) JOB(${job}) TOSTMF('${tmpPath}')${splfnbrClause} STMFOPT(*REPLACE)`;
    const cmdResult = await getConn().runCommand({ command: cpySplf, environment: 'ile' });
    if (cmdResult.code !== 0) {
      const stderr = cmdResult.stderr ?? '';
      if (/not authorized|CPF2189|CPF2177/i.test(stderr)) { throw new Error(`Not authorised to spool file for job ${job}`); }
      if (/not found|CPF3307|CPF3330/i.test(stderr)) { throw new Error(`Job ${job} not found`); }
      throw new Error(`CPYSPLF failed: ${stderr || cmdResult.stdout || 'unknown error'}`);
    }
    const { text: fullContent } = await readIfsAsText(getConn(), tmpPath);
    await getConn().runCommand({ command: `RMVLNK OBJLNK('${tmpPath}')`, environment: 'ile' }).catch(() => {});
    const allLines = fullContent.split('\n');
    const totalLines = allLines.length;
    const startLine = args.startLine != null ? Math.max(Number(args.startLine) - 1, 0) : 0;
    const lineCount = args.lineCount != null ? Number(args.lineCount) : totalLines;
    const selectedLines = allLines.slice(startLine, startLine + lineCount);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        job, splfname, splfnbr: resolvedSplfnbr,
        content: selectedLines.join('\n'),
        startLine: startLine + 1,
        returnedLines: selectedLines.length,
        totalLines,
      }, null, 2) }],
    };
  }

  if (name === 'ibmi_find_jobs') {
    const jobname = String(args.jobname).toUpperCase();
    const username = args.username ? String(args.username).toUpperCase() : undefined;
    const status = args.status ? String(args.status).toUpperCase() : 'ALL';
    const dateFrom = args.date_from ? String(args.date_from) : undefined;
    const dateTo = args.date_to ? String(args.date_to) : undefined;
    // Convert trailing * to % for LIKE matching
    const jobPattern = jobname.endsWith('*') ? jobname.slice(0, -1) + '%' : jobname;
    const jobs: Record<string, unknown>[] = [];

    if (status === 'ACTIVE' || status === 'ALL') {
      const activeConditions: string[] = ['1=1'];
      if (username) { activeConditions.push(`JOB_USER = '${username}'`); }
      if (args.subsystem) { activeConditions.push(`SUBSYSTEM = '${String(args.subsystem).toUpperCase()}'`); }
      const activeQuery = `SELECT JOB_NAME_SHORT, JOB_USER, JOB_NUMBER, JOB_STATUS, JOB_ENTERED_SYSTEM_TIME, SUBSYSTEM FROM TABLE(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '${jobPattern}')) WHERE ${activeConditions.join(' AND ')}`;
      const rows = await getConn().runSQL(activeQuery) as Record<string, unknown>[];
      for (const r of rows) {
        jobs.push({
          job_number: String(r['JOB_NUMBER'] ?? ''),
          job_user: String(r['JOB_USER'] ?? ''),
          job_name: String(r['JOB_NAME_SHORT'] ?? ''),
          status: 'ACTIVE',
          end_time: null,
          completion_code: null,
          subsystem: r['SUBSYSTEM'] != null ? String(r['SUBSYSTEM']) : null,
        });
      }
    }

    if (status === 'OUTQ' || status === 'ALL') {
      const startTime = dateFrom ? `'${dateFrom} 00:00:00'` : 'CURRENT_TIMESTAMP - 7 DAYS';
      const endFilter = dateTo ? ` AND MESSAGE_TIMESTAMP <= '${dateTo} 23:59:59'` : '';
      const userFilter = username ? ` AND FROM_JOB_USER = '${username}'` : '';
      const endedQuery = `SELECT FROM_JOB_NAME, FROM_JOB_USER, FROM_JOB_NUMBER, FROM_JOB, MESSAGE_TIMESTAMP, MESSAGE_TEXT FROM TABLE(QSYS2.HISTORY_LOG_INFO(START_TIME => ${startTime})) WHERE MESSAGE_ID = 'CPF1164' AND FROM_JOB_NAME LIKE '${jobPattern}'${userFilter}${endFilter} ORDER BY MESSAGE_TIMESTAMP DESC`;
      const rows = await getConn().runSQL(endedQuery) as Record<string, unknown>[];
      for (const r of rows) {
        const msgText = String(r['MESSAGE_TEXT'] ?? '');
        const codeMatch = /end code (\d+)/i.exec(msgText);
        jobs.push({
          job_number: String(r['FROM_JOB_NUMBER'] ?? ''),
          job_user: String(r['FROM_JOB_USER'] ?? ''),
          job_name: String(r['FROM_JOB_NAME'] ?? ''),
          status: 'ENDED',
          end_time: r['MESSAGE_TIMESTAMP'] != null ? String(r['MESSAGE_TIMESTAMP']) : null,
          completion_code: codeMatch ? Number(codeMatch[1]) : null,
          subsystem: null,
        });
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ jobs, total: jobs.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_get_active_editor') {
    const editor = getActiveEditor();
    if (!editor) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active editor' }) }] };
    }
    const uri = editor.document.uri;
    const doc = await vscode.workspace.openTextDocument(uri);
    const info = parseEditorUri(uri);
    const result = {
      ...info,
      content: doc.getText(),
      isDirty: editor.document.isDirty,
      lineCount: editor.document.lineCount,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  if (name === 'ibmi_list_open_editors') {
    const activeEditor = getActiveEditor();
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
    return { content: [{ type: 'text', text: JSON.stringify(editors, null, 2) }] };
  }

  if (name === 'ibmi_update_active_editor') {
    const editor = getActiveEditor();
    if (!editor) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active editor' }) }] };
    }
    const uri = editor.document.uri;
    const newContent = String(args.content);
    await applyEditorUpdate(uri, newContent);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, uri: uri.toString() }, null, 2) }] };
  }

  if (name === 'ibmi_update_editor_by_uri') {
    const uri = vscode.Uri.parse(String(args.uri));
    const newContent = String(args.content);
    await applyEditorUpdate(uri, newContent);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, uri: uri.toString() }, null, 2) }] };
  }

  if (name === 'ibmi_replace_in_active_editor') {
    const editor = getActiveEditor();
    if (!editor) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active editor' }) }] };
    }

    const oldText = normaliseLineEndings(String(args.oldText));
    const newText = normaliseLineEndings(String(args.newText));
    const doc = editor.document;
    const fullText = doc.getText();

    const firstIdx = fullText.indexOf(oldText);
    if (firstIdx === -1) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'oldText not found in active editor document' }) }], isError: true };
    }
    const secondIdx = fullText.indexOf(oldText, firstIdx + 1);
    if (secondIdx !== -1) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'oldText appears more than once in the document — make it more specific to uniquely identify the target location' }) }], isError: true };
    }

    const startPos = doc.positionAt(firstIdx);
    const endPos   = doc.positionAt(firstIdx + oldText.length);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, uri: doc.uri.toString(), replacedAtLine: startPos.line + 1 }, null, 2) }],
    };
  }

  if (name === 'ibmi_list_objects') {
    const lib = String(args.library).toUpperCase();
    const objType = args.objectType ? String(args.objectType).toUpperCase() : '*ALL';
    let nameClause = '';
    if (args.nameFilter) {
      const pattern = String(args.nameFilter).toUpperCase();
      nameClause = ` WHERE OBJNAME LIKE '${pattern.endsWith('*') ? pattern.slice(0, -1) + '%' : pattern}'`;
    }
    const q = `SELECT OBJNAME, OBJTYPE, OBJATTRIBUTE, OBJTEXT, OBJOWNER, OBJSIZE, LAST_USED_TIMESTAMP FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}'))${nameClause} ORDER BY OBJNAME FETCH FIRST 500 ROWS ONLY`;
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    const objects = rows.map(r => ({
      name: String(r['OBJNAME'] ?? ''), type: String(r['OBJTYPE'] ?? ''),
      attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : '',
      description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : '',
      owner: r['OBJOWNER'] != null ? String(r['OBJOWNER']) : '',
      size: r['OBJSIZE'] != null ? Number(r['OBJSIZE']) : null,
      lastModified: r['LAST_USED_TIMESTAMP'] != null ? String(r['LAST_USED_TIMESTAMP']) : null,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ library: lib, objectType: objType, objects, total: objects.length }, null, 2) }] };
  }

  if (name === 'ibmi_get_object_info') {
    const lib = String(args.library).toUpperCase();
    const objName = String(args.name).toUpperCase();
    const objType = String(args.objectType).toUpperCase();
    const q = `SELECT OBJNAME, OBJTYPE, OBJATTRIBUTE, OBJTEXT, OBJOWNER, OBJSIZE, OBJCREATED, LAST_CHANGED_TIMESTAMP, LAST_USED_TIMESTAMP FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}', OBJECT_NAME => '${objName}')) FETCH FIRST 1 ROW ONLY`;
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ exists: false, library: lib, name: objName, objectType: objType }, null, 2) }] };
    }
    const r = rows[0];
    return { content: [{ type: 'text', text: JSON.stringify({
      exists: true, library: lib, name: String(r['OBJNAME'] ?? ''), objectType: String(r['OBJTYPE'] ?? ''),
      attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : '',
      description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : '',
      owner: r['OBJOWNER'] != null ? String(r['OBJOWNER']) : '',
      size: r['OBJSIZE'] != null ? Number(r['OBJSIZE']) : null,
      createTime: r['OBJCREATED'] != null ? String(r['OBJCREATED']) : null,
      lastModifiedTime: r['LAST_CHANGED_TIMESTAMP'] != null ? String(r['LAST_CHANGED_TIMESTAMP']) : null,
      lastUsedTime: r['LAST_USED_TIMESTAMP'] != null ? String(r['LAST_USED_TIMESTAMP']) : null,
    }, null, 2) }] };
  }

  if (name === 'ibmi_check_object') {
    const lib = String(args.library).toUpperCase();
    const objName = String(args.name).toUpperCase();
    const objType = String(args.objectType).toUpperCase();
    const q = `SELECT OBJNAME, OBJATTRIBUTE, OBJTEXT FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_LIBRARY => '${lib}', OBJECT_TYPE => '${objType}', OBJECT_NAME => '${objName}')) FETCH FIRST 1 ROW ONLY`;
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ exists: false, library: lib, name: objName, objectType: objType }, null, 2) }] };
    }
    const r = rows[0];
    return { content: [{ type: 'text', text: JSON.stringify({
      exists: true, library: lib, name: String(r['OBJNAME'] ?? ''), objectType: objType,
      attribute: r['OBJATTRIBUTE'] != null ? String(r['OBJATTRIBUTE']) : undefined,
      description: r['OBJTEXT'] != null ? String(r['OBJTEXT']) : undefined,
    }, null, 2) }] };
  }

  if (name === 'ibmi_get_data_area') {
    const lib = String(args.library).toUpperCase();
    const daName = String(args.name).toUpperCase();
    const q = `SELECT DATA_AREA_VALUE, DATA_AREA_TYPE, DATA_AREA_LENGTH, DATA_AREA_TEXT FROM TABLE(QSYS2.DATA_AREA_INFO(DATA_AREA_NAME => '${daName}', DATA_AREA_LIBRARY => '${lib}')) FETCH FIRST 1 ROW ONLY`;
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    if (rows.length === 0) { throw new Error(`Data area ${lib}/${daName} not found`); }
    const r = rows[0];
    return { content: [{ type: 'text', text: JSON.stringify({
      library: lib, name: daName,
      value: r['DATA_AREA_VALUE'] != null ? String(r['DATA_AREA_VALUE']) : '',
      dataType: r['DATA_AREA_TYPE'] != null ? String(r['DATA_AREA_TYPE']) : '',
      length: r['DATA_AREA_LENGTH'] != null ? Number(r['DATA_AREA_LENGTH']) : 0,
      description: r['DATA_AREA_TEXT'] != null ? String(r['DATA_AREA_TEXT']) : '',
    }, null, 2) }] };
  }

  if (name === 'ibmi_list_spool_files') {
    const max = Math.min(args.maxFiles != null ? Number(args.maxFiles) : 50, 200);
    const selectClause = `SELECT SPOOLED_FILE_NAME, SPOOLED_FILE_NUMBER, JOB_NAME, STATUS, TOTAL_PAGES, CREATE_TIMESTAMP, OUTPUT_QUEUE_NAME, OUTPUT_QUEUE_LIBRARY_NAME`;
    let q: string;
    if (args.job) {
      const job = String(args.job);
      if (job.split('/').length !== 3) { throw new Error('job must be in NUMBER/USER/NAME format'); }
      const splfFilter = args.splfname ? ` WHERE SPOOLED_FILE_NAME = '${String(args.splfname).toUpperCase()}'` : '';
      q = `${selectClause} FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${job}'))${splfFilter} ORDER BY SPOOLED_FILE_NUMBER DESC FETCH FIRST ${max} ROWS ONLY`;
    } else {
      const conds: string[] = [];
      if (args.username) { conds.push(`JOB_USER_NAME = '${String(args.username).toUpperCase()}'`); }
      if (args.splfname) { conds.push(`SPOOLED_FILE_NAME = '${String(args.splfname).toUpperCase()}'`); }
      const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
      q = `${selectClause} FROM TABLE(QSYS2.SPOOLED_FILE_INFO())${where} ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST ${max} ROWS ONLY`;
    }
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    const spoolFiles = rows.map(r => ({
      job: String(r['JOB_NAME'] ?? ''), splfname: String(r['SPOOLED_FILE_NAME'] ?? ''),
      splfnbr: Number(r['SPOOLED_FILE_NUMBER'] ?? 0),
      status: r['STATUS'] != null ? String(r['STATUS']) : '',
      pages: r['TOTAL_PAGES'] != null ? Number(r['TOTAL_PAGES']) : null,
      createTime: r['CREATE_TIMESTAMP'] != null ? String(r['CREATE_TIMESTAMP']) : null,
      outputQueue: r['OUTPUT_QUEUE_NAME'] != null ? String(r['OUTPUT_QUEUE_NAME']) : '',
      outputQueueLibrary: r['OUTPUT_QUEUE_LIBRARY_NAME'] != null ? String(r['OUTPUT_QUEUE_LIBRARY_NAME']) : '',
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ spoolFiles, total: spoolFiles.length }, null, 2) }] };
  }

  if (name === 'ibmi_get_file_fields') {
    const lib = String(args.library).toUpperCase();
    const file = String(args.file).toUpperCase();
    const q = `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, ${castUtf8('COLUMN_TEXT')} AS COLUMN_TEXT, ORDINAL_POSITION FROM QSYS2.SYSCOLUMNS2 WHERE TABLE_SCHEMA = '${lib}' AND TABLE_NAME = '${file}' ORDER BY ORDINAL_POSITION`;
    const rows = await getConn().runSQL(q) as Record<string, unknown>[];
    const fields = rows.map(r => ({
      name: String(r['COLUMN_NAME'] ?? ''), type: String(r['DATA_TYPE'] ?? ''),
      length: r['LENGTH'] != null ? Number(r['LENGTH']) : 0,
      precision: r['NUMERIC_PRECISION'] != null ? Number(r['NUMERIC_PRECISION']) : null,
      scale: r['NUMERIC_SCALE'] != null ? Number(r['NUMERIC_SCALE']) : null,
      nullable: String(r['IS_NULLABLE'] ?? 'N').toUpperCase() === 'Y',
      default: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : null,
      description: r['COLUMN_TEXT'] != null ? String(r['COLUMN_TEXT']) : '',
      position: Number(r['ORDINAL_POSITION'] ?? 0),
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ library: lib, file, fields, total: fields.length }, null, 2) }] };
  }

  if (name === 'ibmi_get_library_list') {
    const rows = await getConn().runSQL(
      `SELECT SYSTEM_SCHEMA_NAME, TYPE, SCHEMA_POSITION, SCHEMA_TEXT FROM QSYS2.LIBRARY_LIST_INFO ORDER BY SCHEMA_POSITION`
    ) as Record<string, unknown>[];
    const libraries = rows.map(r => ({
      library: String(r['SYSTEM_SCHEMA_NAME'] ?? ''), type: String(r['TYPE'] ?? ''),
      position: Number(r['SCHEMA_POSITION'] ?? 0),
      description: r['SCHEMA_TEXT'] != null ? String(r['SCHEMA_TEXT']) : '',
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ libraries, total: libraries.length }, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleJsonRpc(msg: any): Promise<any | null> {
  const { jsonrpc, method, params, id } = msg;
  if (id === undefined || id === null) { return null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ok = (result: any) => ({ jsonrpc, id, result });
  const err = (code: number, message: string) => ({ jsonrpc, id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: 'ibm-iagentx', version: '0.1.0' },
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: toolArgs = {} } = params ?? {};
      try {
        const result = await callTool(name, toolArgs as Record<string, unknown>);
        return ok(result);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return ok({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
      }
    }
    case 'ping':
      return ok({});
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

// SSE session state
interface SseSession {
  res: http.ServerResponse;
  messageQueue: string[];
}
const sseSessions = new Map<string, SseSession>();
let sseSessionCounter = 0;

function sendSseEvent(session: SseSession, data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  session.res.write(payload);
}

async function handleSseUpgrade(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const sessionId = String(++sseSessionCounter);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-MCP-Session-Id': sessionId,
  });

  // Send endpoint event so client knows where to POST messages
  const host = req.headers.host ?? '127.0.0.1:41927';
  res.write(`event: endpoint\ndata: http://${host}/message?sessionId=${sessionId}\n\n`);

  const session: SseSession = { res, messageQueue: [] };
  sseSessions.set(sessionId, session);

  req.on('close', () => { sseSessions.delete(sessionId); });
}

async function handleSseMessage(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
  const session = sseSessions.get(sessionId);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  let body: string;
  try { body = await readBody(req); } catch { res.writeHead(400); res.end(); return; }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    return;
  }

  res.writeHead(202);
  res.end();

  const msgs = Array.isArray(parsed) ? parsed : [parsed];
  for (const msg of msgs) {
    const response = await handleJsonRpc(msg);
    if (response !== null) {
      sendSseEvent(session, response);
    }
  }
}

async function handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: string;
  try { body = await readBody(req); } catch { res.writeHead(400); res.end(); return; }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    return;
  }

  const msgs = Array.isArray(parsed) ? parsed : [parsed];
  const responses = (await Promise.all(msgs.map(handleJsonRpc))).filter(r => r !== null);

  if (responses.length === 0) { res.writeHead(202); res.end(); return; }
  const result = responses.length === 1 ? responses[0] : responses;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // SSE transport: GET / opens event stream
  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/sse')) {
    await handleSseUpgrade(req, res);
    return;
  }

  // SSE transport: POST /message?sessionId=X sends a message to an SSE session
  if (method === 'POST' && url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId') ?? '';
    await handleSseMessage(req, res, sessionId);
    return;
  }

  // Plain HTTP JSON-RPC transport: POST /
  if (method === 'POST') {
    await handlePostRequest(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

export function createHttpServer(): http.Server {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('[ibm-iagentx] handler error:', err);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    });
  });
}
