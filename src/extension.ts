import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as http from 'http';
import type { CodeForIBMi } from '@halcyontech/vscode-ibmi-types';
import { createHttpServer, setLastActiveEditor } from './mcpServer.js';
import { GetSourceMemberTool } from './tools/getSourceMember.js';
import { ListSourceMembersTool } from './tools/listSourceMembers.js';
import { ListSourceFilesTool } from './tools/listSourceFiles.js';
import { GetIfsFileTool } from './tools/getIfsFile.js';
import { ListIfsDirectoryTool } from './tools/listIfsDirectory.js';
import { RunSqlTool } from './tools/runSql.js';
import { GetJobLogTool } from './tools/getJobLog.js';
import { RunClCommandTool } from './tools/runClCommand.js';
import { ConnectionStatusTool } from './tools/connectionStatus.js';
import { GetActiveEditorTool } from './tools/getActiveEditor.js';
import { ListOpenEditorsTool } from './tools/listOpenEditors.js';
import { UpdateActiveEditorTool } from './tools/updateActiveEditor.js';
import { UpdateEditorByUriTool } from './tools/updateEditorByUri.js';
import { GetSpoolFileTool } from './tools/getSpoolFile.js';
import { FindJobsTool } from './tools/findJobs.js';
import { ListObjectsTool } from './tools/listObjects.js';
import { GetObjectInfoTool } from './tools/getObjectInfo.js';
import { CheckObjectTool } from './tools/checkObject.js';
import { GetDataAreaTool } from './tools/getDataArea.js';
import { ListSpoolFilesTool } from './tools/listSpoolFiles.js';
import { GetFileFieldsTool } from './tools/getFileFields.js';
import { GetLibraryListTool } from './tools/getLibraryList.js';

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

// Probe whether an iAgentX server is already running on this port.
function probeExistingServer(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } },
      res => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.setTimeout(400, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
  });
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

async function updateBobMcpSettings(port: number, channel: vscode.OutputChannel): Promise<boolean> {
  const bobFolder: string = vscode.workspace.getConfiguration('ibm-iagentx').get('bobAppDataFolder') ?? '';
  if (!bobFolder.trim()) {
    channel.appendLine('[iAgentX] Bob app data folder not configured — skipping Bob config');
    return false;
  }

  const platform = process.platform;
  let appDataRoot: string;
  if (platform === 'win32') {
    appDataRoot = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    appDataRoot = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataRoot = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  }

  const bobMcpPath = path.join(
    appDataRoot, bobFolder, 'User', 'globalStorage',
    'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'
  );

  // Only update if the file already exists — confirms Bob is actually installed
  try {
    await fs.access(bobMcpPath);
  } catch {
    channel.appendLine(`[iAgentX] Bob cline_mcp_settings.json not found at ${bobMcpPath} — skipping`);
    return false;
  }

  return updateJsonConfig(
    bobMcpPath,
    port, channel,
    cfg => ((cfg.mcpServers ?? {}) as Record<string, { type: string; url: string }>),
    (cfg, servers) => { cfg.mcpServers = servers; },
    '/sse',
    'Bob cline_mcp_settings.json'
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('IBM iAgentX');
  context.subscriptions.push(channel);
  channel.appendLine('[iAgentX] activate() called');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(loading~spin) iAgentX';
  statusBar.tooltip = 'IBM iAgentX — starting…';
  statusBar.command = 'ibm-iagentx.manage';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Track the last focused editor so MCP tools can still reach it after
  // focus moves to the terminal or chat panel.
  setLastActiveEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => setLastActiveEditor(editor))
  );

  const cfg = vscode.workspace.getConfiguration('ibm-iagentx');
  const preferredPort: number = cfg.get('preferredPort') ?? 41927;

  type ServerState = 'starting' | 'running' | 'stopped' | 'disconnected' | 'shared';
  let serverState: ServerState = 'starting';
  let server: http.Server = createHttpServer();
  let activePort: number | undefined;
  let mcpProvider: vscode.Disposable | undefined;

  function updateStatusBar(): void {
    switch (serverState) {
      case 'starting':
        statusBar.text    = '$(loading~spin) iAgentX';
        statusBar.tooltip = 'IBM iAgentX — starting…';
        break;
      case 'running':
        statusBar.text    = `$(check) iAgentX :${activePort}`;
        statusBar.tooltip = `IBM iAgentX running on http://127.0.0.1:${activePort} — click to manage`;
        break;
      case 'disconnected':
        statusBar.text    = `$(warning) iAgentX :${activePort}`;
        statusBar.tooltip = 'IBM iAgentX — IBM i disconnected — IBM i tools unavailable (VS Code tools still work)';
        break;
      case 'stopped':
        statusBar.text    = '$(circle-slash) iAgentX';
        statusBar.tooltip = 'IBM iAgentX — MCP server stopped — click to manage';
        break;
      case 'shared':
        statusBar.text    = `$(check) iAgentX :${activePort} (shared)`;
        statusBar.tooltip = `IBM iAgentX — shared server on port ${activePort} (owned by another VS Code window)`;
        break;
    }
  }

  function registerMcpProvider(port: number): void {
    mcpProvider?.dispose();
    mcpProvider = vscode.lm.registerMcpServerDefinitionProvider(SERVER_NAME, {
      provideMcpServerDefinitions(_token) {
        return [new vscode.McpHttpServerDefinition(
          'IBM iAgentX',
          vscode.Uri.parse(`http://127.0.0.1:${port}`),
          {}, '0.1.0'
        )];
      },
    });
  }

  function stopServer(): Promise<void> {
    return new Promise(resolve => {
      server.close(() => {
        serverState = 'stopped';
        activePort = undefined;
        updateStatusBar();
        channel.appendLine('[iAgentX] MCP server stopped.');
        resolve();
      });
    });
  }

  function startServer(): void {
    serverState = 'starting';
    updateStatusBar();
    server = createHttpServer();

    listenWithFallback(server, preferredPort, PORT_ATTEMPTS, (err, port) => {
      if (err || port === undefined) {
        const msg = `Failed to start server: ${err?.message}`;
        channel.appendLine(`[iAgentX] ${msg}`);
        vscode.window.showErrorMessage(`IBM iAgentX: ${msg}`);
        statusBar.text    = '$(error) iAgentX';
        statusBar.tooltip = `IBM iAgentX — failed: ${err?.message}`;
        return;
      }

      activePort = port;
      channel.appendLine(`[iAgentX] HTTP server listening on http://127.0.0.1:${port}`);

      // Set initial IBM i connection state
      const ibmiExt = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
      const isIbmiConnected = ibmiExt?.isActive && !!ibmiExt.exports.instance.getConnection();
      serverState = (ibmiExt && !isIbmiConnected) ? 'disconnected' : 'running';
      updateStatusBar();

      registerMcpProvider(port);

      Promise.all([
        updateClaudeJson(port, channel),
        updateVscodeMcpJson(port, channel),
        updateBobMcpSettings(port, channel),
      ]).then(([claudeChanged, mcpChanged, bobChanged]) => {
        channel.appendLine('[iAgentX] startServer() complete');
        if (claudeChanged || mcpChanged || bobChanged) {
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
  }

  function subscribeToIbmiEvents(): void {
    const ibmiExt = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
    if (!ibmiExt?.isActive) {
      channel.appendLine('[iAgentX] Code for IBM i not active — IBM i event subscription skipped.');
      return;
    }
    const instance = ibmiExt.exports.instance;

    instance.subscribe(context, 'connected', 'iAgentX-connected', () => {
      if (serverState !== 'stopped') {
        serverState = 'running';
        updateStatusBar();
        channel.appendLine('[iAgentX] IBM i connected — status updated.');
      }
    });
    instance.subscribe(context, 'disconnected', 'iAgentX-disconnected', () => {
      if (serverState !== 'stopped') {
        serverState = 'disconnected';
        updateStatusBar();
        channel.appendLine('[iAgentX] IBM i disconnected — status updated.');
      }
    });

    channel.appendLine('[iAgentX] Subscribed to Code for IBM i connected/disconnected events.');
  }

  // Keep backward-compatible reconnect command
  const reconnect = vscode.commands.registerCommand('ibm-iagentx.reconnect', () => {
    if (activePort === undefined) {
      vscode.window.showWarningMessage('IBM iAgentX: Server is not running yet.');
      return;
    }
    channel.appendLine(`[iAgentX] Reconnect requested on port ${activePort}`);
    Promise.all([
      updateClaudeJson(activePort, channel),
      updateVscodeMcpJson(activePort, channel),
      updateBobMcpSettings(activePort, channel),
    ]).then(() => {
      vscode.window.showInformationMessage(
        `IBM iAgentX: Config refreshed (port ${activePort}). Start a new Claude Code session if needed.`
      );
    }).catch(e => {
      vscode.window.showWarningMessage(`IBM iAgentX: Reconnect failed — ${(e as Error).message}`);
    });
  });
  context.subscriptions.push(reconnect);

  // Manage command — status bar click opens quick pick
  const manage = vscode.commands.registerCommand('ibm-iagentx.manage', async () => {
    type Item = vscode.QuickPickItem & { action: string };
    const items: Item[] = [];

    if (serverState === 'running' || serverState === 'disconnected') {
      items.push({ label: '$(debug-stop) Stop iAgentX server',    description: 'Shut down the iAgentX server',          action: 'stop'    });
      items.push({ label: '$(refresh) Restart iAgentX server',    description: 'Stop and restart the iAgentX server',   action: 'restart' });
      items.push({ label: '$(sync) Refresh iAgentX config',       description: 'Re-write ~/.claude.json and mcp.json',  action: 'refresh' });
    } else if (serverState === 'stopped') {
      items.push({ label: '$(play) Start iAgentX server',         description: 'Start the iAgentX server',              action: 'start'   });
      items.push({ label: '$(sync) Refresh iAgentX config',       description: 'Re-write ~/.claude.json and mcp.json',  action: 'refresh' });
    } else if (serverState === 'shared') {
      items.push({ label: '$(sync) Refresh iAgentX config',       description: 'Re-write ~/.claude.json and mcp.json',  action: 'refresh' });
    } else {
      vscode.window.showInformationMessage('IBM iAgentX: Server is starting, please wait…');
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `iAgentX MCP server — current state: ${serverState}`,
    }) as Item | undefined;
    if (!picked) { return; }

    switch (picked.action) {
      case 'stop':
        await stopServer();
        break;
      case 'start':
        startServer();
        break;
      case 'restart':
        await stopServer();
        startServer();
        break;
      case 'refresh':
        if (activePort === undefined) {
          vscode.window.showWarningMessage('IBM iAgentX: Server is not running.');
          return;
        }
        Promise.all([
          updateClaudeJson(activePort, channel),
          updateVscodeMcpJson(activePort, channel),
          updateBobMcpSettings(activePort, channel),
        ]).then(() => {
          vscode.window.showInformationMessage(
            `IBM iAgentX: Config refreshed (port ${activePort}). Start a new Claude Code session if needed.`
          );
        }).catch(e => {
          vscode.window.showWarningMessage(`IBM iAgentX: Refresh failed — ${(e as Error).message}`);
        });
        break;
    }
  });
  context.subscriptions.push(manage);

  // Register tools with VS Code's language model (GitHub Copilot Chat)
  const lmTools: vscode.Disposable[] = [
    vscode.lm.registerTool('ibmi_get_source_member',    new GetSourceMemberTool()),
    vscode.lm.registerTool('ibmi_list_source_members',  new ListSourceMembersTool()),
    vscode.lm.registerTool('ibmi_list_source_files',    new ListSourceFilesTool()),
    vscode.lm.registerTool('ibmi_get_ifs_file',         new GetIfsFileTool()),
    vscode.lm.registerTool('ibmi_list_ifs_directory',   new ListIfsDirectoryTool()),
    vscode.lm.registerTool('ibmi_run_sql',              new RunSqlTool()),
    vscode.lm.registerTool('ibmi_get_job_log',          new GetJobLogTool()),
    vscode.lm.registerTool('ibmi_run_cl_command',       new RunClCommandTool()),
    vscode.lm.registerTool('ibmi_connection_status',    new ConnectionStatusTool()),
    vscode.lm.registerTool('ibmi_get_active_editor',    new GetActiveEditorTool()),
    vscode.lm.registerTool('ibmi_list_open_editors',    new ListOpenEditorsTool()),
    vscode.lm.registerTool('ibmi_update_active_editor', new UpdateActiveEditorTool()),
    vscode.lm.registerTool('ibmi_update_editor_by_uri', new UpdateEditorByUriTool()),
    vscode.lm.registerTool('ibmi_get_spool_file',       new GetSpoolFileTool()),
    vscode.lm.registerTool('ibmi_find_jobs',            new FindJobsTool()),
    vscode.lm.registerTool('ibmi_list_objects',         new ListObjectsTool()),
    vscode.lm.registerTool('ibmi_get_object_info',      new GetObjectInfoTool()),
    vscode.lm.registerTool('ibmi_check_object',         new CheckObjectTool()),
    vscode.lm.registerTool('ibmi_get_data_area',        new GetDataAreaTool()),
    vscode.lm.registerTool('ibmi_list_spool_files',     new ListSpoolFilesTool()),
    vscode.lm.registerTool('ibmi_get_file_fields',      new GetFileFieldsTool()),
    vscode.lm.registerTool('ibmi_get_library_list',     new GetLibraryListTool()),
  ];
  context.subscriptions.push(...lmTools);

  // Probe whether another VS Code window already owns a server on the preferred port.
  const alreadyRunning = await probeExistingServer(preferredPort);
  if (alreadyRunning) {
    activePort = preferredPort;
    serverState = 'shared';
    updateStatusBar();
    channel.appendLine(`[iAgentX] Existing server detected on port ${preferredPort} — shared mode.`);
    registerMcpProvider(preferredPort);
    await Promise.all([
      updateClaudeJson(preferredPort, channel),
      updateVscodeMcpJson(preferredPort, channel),
      updateBobMcpSettings(preferredPort, channel),
    ]);
    subscribeToIbmiEvents();
    return;
  }

  startServer();
  subscribeToIbmiEvents();

  context.subscriptions.push({
    dispose() {
      mcpProvider?.dispose();
      if (serverState !== 'shared') { server.close(); }
    },
  });
}

export function deactivate(): void {}
