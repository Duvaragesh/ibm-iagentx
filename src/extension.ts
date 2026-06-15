import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as http from 'http';
import { createHttpServer } from './mcpServer.js';
import { GetSourceMemberTool } from './tools/getSourceMember.js';
import { ListSourceMembersTool } from './tools/listSourceMembers.js';
import { ListSourceFilesTool } from './tools/listSourceFiles.js';
import { GetIfsFileTool } from './tools/getIfsFile.js';
import { ListIfsDirectoryTool } from './tools/listIfsDirectory.js';
import { RunSqlTool } from './tools/runSql.js';
import { GetJobLogTool } from './tools/getJobLog.js';
import { RunClCommandTool } from './tools/runClCommand.js';
import { ConnectionStatusTool } from './tools/connectionStatus.js';

const SERVER_NAME = 'ibm-iagentx';
const OLD_SERVER_NAME = 'dk-ibmi-mcp'; // legacy key — removed from configs on first run
const PORT_ATTEMPTS = 5;

function listenWithFallback(
  server: http.Server,
  preferred: number,
  maxAttempts: number,
  callback: (err: Error | null, port?: number) => void
): void {
  let attempt = 0;

  const tryPort = (port: number) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError);
      if (err.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
        attempt++;
        tryPort(preferred + attempt);
      } else {
        callback(err);
      }
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      callback(null, port);
    });
  };

  tryPort(preferred);
}

async function updateJsonConfig(
  filePath: string,
  port: number,
  channel: vscode.OutputChannel,
  getServers: (config: Record<string, unknown>) => Record<string, { type: string; url: string }>,
  setServers: (config: Record<string, unknown>, servers: Record<string, { type: string; url: string }>) => void,
  urlSuffix: string,
  label: string
): Promise<boolean> {
  const newUrl = `http://127.0.0.1:${port}${urlSuffix}`;

  let config: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist yet — will be created
  }

  const servers = getServers(config);

  // Remove legacy key from previous extension name
  if (OLD_SERVER_NAME in servers) {
    delete servers[OLD_SERVER_NAME];
    channel.appendLine(`[iAgentX] removed legacy key "${OLD_SERVER_NAME}" from ${label}`);
  }

  const existing = servers[SERVER_NAME];
  if (existing?.type === 'sse' && existing?.url === newUrl) {
    channel.appendLine(`[iAgentX] ${label} already configured (port ${port})`);
    return false;
  }

  servers[SERVER_NAME] = { type: 'sse', url: newUrl };
  setServers(config, servers);
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  channel.appendLine(`[iAgentX] ${label} updated → ${newUrl}`);
  return true;
}

async function updateClaudeJson(port: number, channel: vscode.OutputChannel): Promise<boolean> {
  return updateJsonConfig(
    path.join(os.homedir(), '.claude.json'),
    port, channel,
    cfg => ((cfg.mcpServers ?? {}) as Record<string, { type: string; url: string }>),
    (cfg, servers) => { cfg.mcpServers = servers; },
    '/sse',
    '~/.claude.json'
  );
}

async function updateVscodeMcpJson(port: number, channel: vscode.OutputChannel): Promise<boolean> {
  // VS Code global MCP config: %APPDATA%/Code/User/mcp.json (Windows)
  //                             ~/Library/Application Support/Code/User/mcp.json (macOS)
  //                             ~/.config/Code/User/mcp.json (Linux)
  const platform = process.platform;
  let userDataDir: string;
  if (platform === 'win32') {
    userDataDir = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    userDataDir = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    userDataDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  }
  const mcpJsonPath = path.join(userDataDir, 'Code', 'User', 'mcp.json');

  return updateJsonConfig(
    mcpJsonPath,
    port, channel,
    cfg => ((cfg.servers ?? {}) as Record<string, { type: string; url: string }>),
    (cfg, servers) => { cfg.servers = servers; },
    '/sse',
    'mcp.json'
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('IBM iAgentX');
  context.subscriptions.push(channel);
  channel.appendLine('[iAgentX] activate() called');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(loading~spin) iAgentX';
  statusBar.tooltip = 'IBM iAgentX — starting…';
  statusBar.command = 'ibm-iagentx.reconnect';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
  const preferredPort: number = cfg.get('preferredPort') ?? 41927;

  const server = createHttpServer();

  // activePort is set once the server is listening; used by the reconnect command
  let activePort: number | undefined;

  const reconnect = vscode.commands.registerCommand('ibm-iagentx.reconnect', () => {
    if (activePort === undefined) {
      vscode.window.showWarningMessage('IBM iAgentX: Server is not running yet.');
      return;
    }
    channel.appendLine(`[iAgentX] Reconnect requested on port ${activePort}`);
    Promise.all([
      updateClaudeJson(activePort, channel),
      updateVscodeMcpJson(activePort, channel),
    ]).then(() => {
      vscode.window.showInformationMessage(
        `IBM iAgentX: Config refreshed (port ${activePort}). Start a new Claude Code session if needed.`
      );
    }).catch(e => {
      vscode.window.showWarningMessage(`IBM iAgentX: Reconnect failed — ${(e as Error).message}`);
    });
  });
  context.subscriptions.push(reconnect);

  // Register tools with VS Code's language model (GitHub Copilot Chat)
  const lmTools: vscode.Disposable[] = [
    vscode.lm.registerTool('ibmi_get_source_member',   new GetSourceMemberTool()),
    vscode.lm.registerTool('ibmi_list_source_members', new ListSourceMembersTool()),
    vscode.lm.registerTool('ibmi_list_source_files',   new ListSourceFilesTool()),
    vscode.lm.registerTool('ibmi_get_ifs_file',        new GetIfsFileTool()),
    vscode.lm.registerTool('ibmi_list_ifs_directory',  new ListIfsDirectoryTool()),
    vscode.lm.registerTool('ibmi_run_sql',             new RunSqlTool()),
    vscode.lm.registerTool('ibmi_get_job_log',         new GetJobLogTool()),
    vscode.lm.registerTool('ibmi_run_cl_command',      new RunClCommandTool()),
    vscode.lm.registerTool('ibmi_connection_status',   new ConnectionStatusTool()),
  ];
  context.subscriptions.push(...lmTools);

  listenWithFallback(server, preferredPort, PORT_ATTEMPTS, (err, port) => {
    if (err || port === undefined) {
      const msg = `Failed to start server: ${err?.message}`;
      channel.appendLine(`[iAgentX] ${msg}`);
      vscode.window.showErrorMessage(`IBM iAgentX: ${msg}`);
      statusBar.text = '$(error) iAgentX';
      statusBar.tooltip = `IBM iAgentX — failed: ${err?.message}`;
      return;
    }

    activePort = port;
    channel.appendLine(`[iAgentX] HTTP server listening on http://127.0.0.1:${port}`);
    statusBar.text = `$(check) iAgentX :${port}`;
    statusBar.tooltip = `IBM iAgentX running on http://127.0.0.1:${port} — click to reconnect`;

    // Register with VS Code MCP registry (used by Copilot and MCP: List Servers)
    const mcpProvider = vscode.lm.registerMcpServerDefinitionProvider(SERVER_NAME, {
      provideMcpServerDefinitions(_token) {
        return [new vscode.McpHttpServerDefinition(
          'IBM iAgentX',
          vscode.Uri.parse(`http://127.0.0.1:${port}`),
          {}, '0.1.0'
        )];
      },
    });
    context.subscriptions.push(mcpProvider);

    // Auto-configure both ~/.claude.json (Claude Code) and mcp.json (VS Code / Copilot)
    Promise.all([
      updateClaudeJson(port, channel),
      updateVscodeMcpJson(port, channel),
    ]).then(([claudeChanged, mcpChanged]) => {
      channel.appendLine('[iAgentX] activate() complete');
      if (claudeChanged || mcpChanged) {
        vscode.window.showInformationMessage(
          `IBM iAgentX: Server registered on port ${port}. Start a new Claude Code session to use IBM i tools.`,
          'OK'
        );
      }
    }).catch(e => {
      const msg = `Could not update config files: ${(e as Error).message}`;
      channel.appendLine(`[iAgentX] WARNING — ${msg}`);
      vscode.window.showWarningMessage(`IBM iAgentX: ${msg}`);
    });
  });

  context.subscriptions.push({ dispose() { server.close(); } });
}

export function deactivate(): void {}
