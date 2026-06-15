# IBM iAgentX

**Extends IBM i resources into VS Code AI agents — GitHub Copilot Chat, Claude Code, and IBM watsonx Code Assistant (Bob).**

IBM iAgentX is a VS Code extension that bridges your IBM i system (AS/400, iSeries) to
AI coding agents via the Model Context Protocol (MCP). It reuses the active SSH connection
from [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi)
— no second connection, no credentials to manage.

Ask Claude Code, GitHub Copilot, or IBM Bob to read source members, browse IFS files, query DB2,
pull job logs, and run CL commands — all directly from the AI chat.

---

## Features

- Read source members from any library/SPF
- List source physical files and their members
- Read and browse IFS files and directories
- Run read-only SQL against DB2 for i
- Retrieve job log messages
- Run read-only CL commands (allowlisted prefixes)
- Auto-configures Claude Code and VS Code on first activation
- Status bar with one-click reconnect

---

## Requirements

- VS Code 1.99 or later
- [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi) — installed and connected to an IBM i system
- Claude Code CLI (for MCP tool use outside VS Code)
- IBM watsonx Code Assistant (Bob) — for IBM i COBOL/RPG modernisation workflows

---

## Build from source

**Prerequisites:** Node.js 18+ and npm.

```bash
git clone https://github.com/dotDK/ibm-iagentx.git
cd ibm-iagentx
npm install
npm run package
```

This produces `ibm-iagentx-<version>.vsix` in the project root.

---

## Installation

Install the `.vsix` file directly:

```
Extensions view → ⋯ → Install from VSIX… → select ibm-iagentx-0.1.0.vsix
```

Or from the command line:

```bash
code --install-extension ibm-iagentx-0.1.0.vsix
```

---

## Setup

### Claude Code (automatic)

On first activation IBM iAgentX writes its MCP server URL into `~/.claude.json`
automatically:

```json
{
  "mcpServers": {
    "ibm-iagentx": {
      "type": "sse",
      "url": "http://127.0.0.1:41927/sse"
    }
  }
}
```

After installing, **start a new Claude Code session** — the IBM i tools will be
discovered automatically.

### GitHub Copilot Chat (automatic)

The extension writes to `%APPDATA%/Code/User/mcp.json` (Windows) or the platform
equivalent, and registers itself via VS Code's MCP provider API. Copilot Chat picks
this up without any manual configuration.

### IBM watsonx Code Assistant / Bob (automatic)

IBM Bob also reads `mcp.json` for MCP server discovery. No additional configuration
is required — the same entry written for Copilot is picked up by Bob automatically.

### Port conflict

The server starts on port **41927** by default and automatically tries the next 4 ports
(41928–41931) if busy. The status bar shows the actual port. If the port changes between
VS Code restarts, click the status bar item to refresh config and restart your Claude
Code session.

To pin a port permanently:

```json
"ibm-iagentx.preferredPort": 41927
```

---

## Status Bar

| Display | Meaning |
|---|---|
| `⟳ iAgentX` (spinning) | Server is starting |
| `✓ iAgentX :41927` | Running on port 41927 — click to reconnect |
| `✗ iAgentX` | Failed to bind any port |

Click the status bar item (or run **IBM iAgentX: Reconnect** from the Command Palette)
to re-write the config files with the current port.

---

## Available Tools

### `ibmi_connection_status`
Check whether an IBM i connection is active. Safe to call at any time.

```
Input:  (none)
Output: { connected: true, host: "my-ibmi", user: "MYUSER", port: 22, connectionName: "DEV" }
        { connected: false }
```

### `ibmi_get_source_member`
Retrieve the full source code of a member.

```
Input:  library (string), spf (string), member (string)
Output: { library, spf, member, memberType, content, lines }
Example: ibmi_get_source_member("DK", "QCLLESRC", "BATCHFTP")
```

### `ibmi_list_source_members`
List members in a source physical file.

```
Input:  library (string), spf (string), filter? (string, * wildcard)
Output: { library, spf, total, members: [{ name, type, description, lastModified, lines }] }
Example: ibmi_list_source_members("DK", "QCLLESRC", "BATCH*")
```

### `ibmi_list_source_files`
List all source physical files in a library.

```
Input:  library (string)
Output: { library, total, files: [{ name, description }] }
Example: ibmi_list_source_files("DK")
```

### `ibmi_get_ifs_file`
Read a file from the IFS.

```
Input:  path (string)
Output: { path, content, size }
Example: ibmi_get_ifs_file("/home/MYUSER/scripts/deploy.sh")
```

### `ibmi_list_ifs_directory`
List contents of an IFS directory.

```
Input:  path (string)
Output: { path, total, entries: [{ name, type, path, size, lastModified, owner }] }
Example: ibmi_list_ifs_directory("/home/MYUSER")
```

### `ibmi_run_sql`
Run a read-only SQL query against DB2 for i.

```
Input:  query (string), maxRows? (number, default 100, max 1000)
Output: { rows, columns, rowCount }
Note:   Only SELECT, WITH (CTEs), and VALUES statements are permitted.
Example: ibmi_run_sql("SELECT * FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DK'")
```

### `ibmi_get_job_log`
Retrieve job log messages via `QSYS2.JOBLOG_INFO`.

```
Input:  job? (string — NUMBER/USER/NAME format, or omit for current job)
Output: { total, messages: [{ id, text, severity, type }] }
Example: ibmi_get_job_log()
         ibmi_get_job_log("123456/MYUSER/QZDASOINIT")
```

### `ibmi_run_cl_command`
Run a read-only CL command.

```
Input:  command (string)
Output: { output, stderr, exitCode }
Allowed prefixes (configurable): DSP, LST, WRK, CHK, PRT, DMP, RTV, QRY
Example: ibmi_run_cl_command("DSPFD FILE(DK/QCLLESRC)")
         ibmi_run_cl_command("WRKACTJOB")
```

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `ibm-iagentx.preferredPort` | `41927` | HTTP port for the MCP server; falls back to next 4 ports if busy |
| `ibm-iagentx.sqlMaxRows` | `100` | Default max rows returned by `ibmi_run_sql` (1–1000) |
| `ibm-iagentx.clAllowedPrefixes` | `["DSP","LST","WRK","CHK","PRT","DMP","RTV","QRY"]` | CL verb prefixes permitted by `ibmi_run_cl_command` |

---

## Troubleshooting

**Claude Code doesn't see the IBM i tools**

1. Check the status bar — must show `✓ iAgentX :NNNNN`
2. Click the status bar item to trigger a reconnect
3. Start a new Claude Code session after reconnect

**`No active IBM i connection` error**

Open Code for IBM i and connect: `Ctrl+Shift+P` → `IBM i: Connect`.

**Port changed / wrong URL in config**

Click the status bar item — the extension re-writes the config files with the current
port. Then restart Claude Code.

**`ibmi_run_sql` rejects a statement**

Only `SELECT`, `WITH` (CTEs), and `VALUES` are allowed. DML and DDL are blocked.

**CL command rejected**

Add the verb prefix to `ibm-iagentx.clAllowedPrefixes` in VS Code settings.

---

## Architecture

```
Claude Code (CLI)  /  GitHub Copilot Chat  /  IBM Bob (watsonx Code Assistant)
        │
        │  MCP over HTTP+SSE
        │  GET /sse  →  opens event stream
        │  POST /message?sessionId=N  →  JSON-RPC messages
        ▼
VS Code Extension Host  (IBM iAgentX)
  HTTP server  127.0.0.1:41927  (loopback only)
        │
        │  Code for IBM i public API
        ▼
halcyontechltd.code-for-ibmi  (existing SSH session)
        │
        ▼
IBM i System
```

The HTTP server binds to `127.0.0.1` only — never reachable from outside your machine.

---

## Security

- All tools are **read-only** — no write, delete, or compile operations
- `ibmi_run_sql` rejects anything that is not SELECT/WITH/VALUES
- `ibmi_run_cl_command` enforces a configurable verb-prefix allowlist
- No credentials stored — piggybacks on Code for IBM i's SSH session
- MCP HTTP server binds to loopback (`127.0.0.1`) only

---

## License

MIT

---

[GitHub: dotDK/ibm-iagentx](https://github.com/dotDK/ibm-iagentx)
