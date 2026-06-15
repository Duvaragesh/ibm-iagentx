import * as http from 'http';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { getConnection } from './ibmiConnection.js';

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
    description: 'Returns the current IBM i connection status. Use this to check whether a connection is active before running other tools.',
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

  const connection = getConnection();
  const content = connection.getContent();

  if (name === 'ibmi_get_source_member') {
    const lib = String(args.library).toUpperCase();
    const file = String(args.spf).toUpperCase();
    const mem = String(args.member).toUpperCase();
    const members = await content.getMemberList({ library: lib, sourceFile: file, members: mem });
    const meta = members.find(m => m.name.toUpperCase() === mem);
    const localPath = await content.downloadMemberContent(lib, file, mem);
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
    const members = await content.getMemberList({ library: lib, sourceFile: file, members: filter });
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
    const objects = await content.getObjectList({ library: lib, types: ['*FILE'] });
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
    const buf = await content.downloadStreamfileRaw(ifsPath);
    const text = buf.toString('utf-8');
    return {
      content: [{ type: 'text', text: JSON.stringify({ path: ifsPath, content: text, size: buf.length }, null, 2) }],
    };
  }

  if (name === 'ibmi_list_ifs_directory') {
    const ifsPath = String(args.path);
    const files = await content.getFileList(ifsPath);
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
    const rows = await connection.runSQL(query) as Record<string, unknown>[];
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
    const rows = await connection.runSQL(query) as Record<string, unknown>[];
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
    const result = await connection.runCommand({ command, environment: 'ile' });
    return {
      content: [{ type: 'text', text: JSON.stringify({
        output: result.stdout ?? '',
        stderr: result.stderr || undefined,
        exitCode: result.code ?? 0,
      }, null, 2) }],
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
