import * as http from 'http';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { getConnection } from './ibmiConnection.js';
import { parseEditorUri } from './utils/parseEditorUri.js';

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
    description: 'Returns the current IBM i connection status. Use this to check whether a connection is active before running other tools. ' +
      'Available tools: ibmi_connection_status, ibmi_get_active_editor, ibmi_list_open_editors, ibmi_update_active_editor, ' +
      'ibmi_update_editor_by_uri, ibmi_replace_in_active_editor, ibmi_get_source_member, ibmi_list_source_members, ' +
      'ibmi_list_source_files, ibmi_get_ifs_file, ibmi_list_ifs_directory, ibmi_run_sql, ibmi_get_job_log, ibmi_run_cl_command. ' +
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
    description: 'Runs a read-only SQL SELECT query against DB2 for i and returns the result rows. Only SELECT, WITH (CTEs), and VALUES statements are permitted.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT statement to execute' },
        maxRows: { type: 'number', description: 'Maximum rows to return (default 100, max 1000)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ibmi_get_job_log',
    description: 'Retrieves the most recent job log messages (up to 100). Defaults to the current job; pass a qualified job name (NUMBER/USER/NAME) to query another job.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Qualified job name in NUMBER/USER/NAME format, or omit for the current job' },
      },
      required: [],
    },
  },
  {
    name: 'ibmi_run_cl_command',
    description: 'Runs a read-only CL command (DSP*, WRK*, CHK*, RTV*, PRT*, DMP*, LST*, QRY* prefixes only) and returns its output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'CL command to run (e.g. DSPFD FILE(MYLIB/QCLLESRC))' },
      },
      required: ['command'],
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
    return {
      content: [{ type: 'text', text: JSON.stringify({
        connected: true,
        host: conn.currentHost,
        user: conn.currentUser,
        port: conn.currentPort,
        connectionName: conn.currentConnectionName,
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
    const buf = await getContent().downloadStreamfileRaw(ifsPath);
    const text = buf.toString('utf-8');
    return {
      content: [{ type: 'text', text: JSON.stringify({ path: ifsPath, content: text, size: buf.length }, null, 2) }],
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
    const trimmed = query.trim().toUpperCase();
    if (!/^(SELECT|WITH|VALUES)\b/.test(trimmed)) {
      throw new Error('Only SELECT statements are allowed. DML and DDL are not permitted.');
    }
    const rows = await getConn().runSQL(query) as Record<string, unknown>[];
    const sliced = rows.slice(0, maxRows);
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
    return {
      content: [{ type: 'text', text: JSON.stringify({ rows: sliced, columns, rowCount: sliced.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_get_job_log') {
    let query: string;
    if (args.job) {
      const parts = String(args.job).split('/');
      if (parts.length !== 3) {
        throw new Error('job must be in NUMBER/USER/NAME format');
      }
      const [number, user, jobName] = parts;
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, SEVERITY, MESSAGE_TYPE FROM TABLE(QSYS2.JOBLOG_INFO('${number}/${user}/${jobName}')) ORDER BY ORDINAL_POSITION DESC FETCH FIRST 100 ROWS ONLY`;
    } else {
      query = `SELECT MESSAGE_ID, MESSAGE_TEXT, SEVERITY, MESSAGE_TYPE FROM TABLE(QSYS2.JOBLOG_INFO('*')) ORDER BY ORDINAL_POSITION DESC FETCH FIRST 100 ROWS ONLY`;
    }
    const rows = await getConn().runSQL(query) as Record<string, unknown>[];
    const messages = rows.map(r => ({
      id: String(r['MESSAGE_ID'] ?? ''),
      text: String(r['MESSAGE_TEXT'] ?? ''),
      severity: r['SEVERITY'] != null ? Number(r['SEVERITY']) : undefined,
      type: r['MESSAGE_TYPE'] != null ? String(r['MESSAGE_TYPE']) : undefined,
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ messages, total: messages.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_run_cl_command') {
    const command = String(args.command);
    const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
    const ALLOWED_PREFIXES: string[] = cfg.get('clAllowedPrefixes') ?? ['DSP', 'LST', 'WRK', 'CHK', 'PRT', 'DMP', 'RTV', 'QRY'];
    const verb = command.trim().toUpperCase().split(/\s+/)[0];
    if (!ALLOWED_PREFIXES.some(p => verb.startsWith(p))) {
      throw new Error(`Command not allowed. Only read-only commands starting with ${ALLOWED_PREFIXES.join(', ')} are permitted.`);
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
