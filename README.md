# IBM iAgentX

**Extends IBM i resources into VS Code AI agents — GitHub Copilot Chat, Claude Code, and IBM Bob.**

IBM iAgentX is a VS Code extension that bridges your IBM i system (AS/400, iSeries) to
AI coding agents via the Model Context Protocol (MCP). It reuses the active SSH connection
from [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi)
— no second connection, no credentials to manage.

Ask Claude Code, GitHub Copilot, or IBM Bob to read source members, browse IFS files, query DB2,
explore objects, pull job logs, retrieve spool files, and run CL commands — all directly from the AI chat.

> **IBM iAgentX is updated frequently.** Enable auto-updates in VS Code: **Extensions** →
> right-click **IBM iAgentX** → **Enable Auto Update**.

---

## Features

- Read and edit source members from any library/SPF
- List source physical files and their members
- Read and browse IFS files and directories
- Run read-only SQL against DB2 for i with offset pagination
- Explore objects in a library — list by type, check existence, read data areas, inspect file fields
- Retrieve the current library list
- Retrieve job log messages with severity, type, and timestamp filtering
- List, search, and retrieve spool files from any job — with line-range support for large files
- Search for jobs by name pattern, user, subsystem, and status
- Run read-only CL commands (allowlisted prefixes; CPYSPLF to `/tmp/` also permitted)
- Edit open source members directly from the AI agent — surgical single-line replacements or full updates
- Auto-configures Claude Code and VS Code on first activation
- Status bar with live IBM i connection state and server management menu

---

## Requirements

- VS Code 1.99 or later
- [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi) — installed and connected to an IBM i system
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) and [Claude Code VS Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) (optional — for AI chat with MCP tool use)
- GitHub Copilot or IBM Bob (optional — for in-editor AI chat)

---

## Build from source

**Prerequisites:** Node.js 18+ and npm.

```bash
git clone https://github.com/Duvaragesh/ibm-iagentx.git
cd ibm-iagentx
npm install
npm run package
```

This produces `ibm-iagentx-<version>.vsix` in the project root.

---

## Installation

Install the `.vsix` file directly:

```
Extensions view → ⋯ → Install from VSIX… → select ibm-iagentx-<version>.vsix
```

Or from the command line:

```bash
code --install-extension ibm-iagentx-<version>.vsix
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

### IBM Bob (automatic)

IBM iAgentX auto-configures IBM Bob by writing to its MCP settings file. Set the
`ibm-iagentx.bobAppDataFolder` setting to the app data folder name Bob uses on your machine
(e.g. `IBMBob`) — leave it blank to skip Bob configuration.

The file updated is:

```
%APPDATA%\<bobAppDataFolder>\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

For example, with `bobAppDataFolder` set to `IBMBob`:

```
%APPDATA%\IBMBob\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

The extension only updates this file if it already exists — confirming Bob is installed before writing.

### Port conflict

The server starts on port **41927** by default and automatically tries the next 4 ports
(41928–41931) if busy. The status bar shows the actual port. If the port changes between
VS Code restarts, click the status bar item → **Refresh iAgentX config** and restart
your Claude Code session.

To pin a port permanently:

```json
"ibm-iagentx.preferredPort": 41927
```

---

## Status Bar

| Display | Meaning |
|---|---|
| `⟳ iAgentX` | Server is starting |
| `✓ iAgentX :41927` | Running — IBM i connected |
| `✓ iAgentX :41927 (shared)` | Another VS Code window owns the server — this window reuses it |
| `⚠ iAgentX :41927` | Server running but IBM i disconnected — IBM i tools unavailable, editor tools still work |
| `⊘ iAgentX` | Server manually stopped |
| `✗ iAgentX` | Failed to bind any port |

Click the status bar item to open the management menu (Start / Stop / Restart / Refresh config),
or run **IBM iAgentX: Manage MCP Server** from the Command Palette.

### Multiple VS Code Windows

Only one iAgentX server runs at a time. When a second VS Code window opens, it detects the
existing server and enters shared mode — the status bar shows `(shared)` and AI tools route
through the same server. No extra ports are used.

---

## Available Tools

### Connection

#### `ibmi_connection_status`
Check whether an IBM i connection is active. Also returns the IBM i OS version when connected.
Safe to call at any time — does not require an active connection.

```
Input:  (none)
Output: { connected, host?, user?, port?, connectionName?, osVersion? }
Example output (connected):
  { "connected": true, "host": "my-ibmi", "user": "MYUSER", "port": 22, "osVersion": "V7R5M0" }
Example output (disconnected):
  { "connected": false }
```

---

### Source Members & Libraries

#### `ibmi_get_source_member`
Retrieve the full source code of a member.

```
Input:  library (string), spf (string), member (string)
Output: { library, spf, member, memberType, content, lines }
Example: ibmi_get_source_member("DK", "QCLLESRC", "BATCHFTP")
```

#### `ibmi_list_source_members`
List members in a source physical file.

```
Input:  library (string), spf (string), filter? (string, * wildcard)
Output: { library, spf, total, members: [{ name, type, description, lastModified, lines }] }
Example: ibmi_list_source_members("DK", "QCLLESRC", "BATCH*")
```

#### `ibmi_list_source_files`
List all source physical files in a library.

```
Input:  library (string)
Output: { library, total, files: [{ name, description }] }
Example: ibmi_list_source_files("DK")
```

#### `ibmi_list_objects`
List objects in a library, filtered by type and/or name pattern. Returns up to 500 objects.

```
Input:  library (string), objectType? (string, default *ALL), nameFilter? (string, * wildcard)
Output: { library, objectType, total, objects: [{ name, type, attribute, description, owner, size, lastModified }] }
Example: ibmi_list_objects("DK", "*PGM")
         ibmi_list_objects("DK", "*FILE", "CUST*")
```

#### `ibmi_get_object_info`
Detailed attributes of a single IBM i object. Returns `exists: false` when the object is not found — never throws.

```
Input:  library (string), name (string), objectType (string)
Output: { exists, library, name, objectType, attribute?, description?, owner?, size?,
          createTime?, lastModifiedTime?, lastUsedTime? }
Example: ibmi_get_object_info("DK", "CUSTMST", "*FILE")
```

#### `ibmi_check_object`
Lightweight existence check for any IBM i object. Use as a guard before performing an operation.

```
Input:  library (string), name (string), objectType (string)
Output: { exists, library, name, objectType, attribute?, description? }
Example: ibmi_check_object("DK", "BATCHPGM", "*PGM")
```

#### `ibmi_get_file_fields`
Field definitions for an IBM i physical or logical file. Includes SQL type, length, precision/scale, nullability, and IBM i text description.

```
Input:  library (string), file (string)
Output: { library, file, total, fields: [{ name, type, length, precision, scale, nullable, default, description, position }] }
Example: ibmi_get_file_fields("DK", "CUSTMST")
```

#### `ibmi_get_library_list`
Return the current library list for the IBM i connection, ordered by position.

```
Input:  (none)
Output: { total, libraries: [{ library, type, position, description }] }
Types:  *SYS (system), *PROD (product), *CUR (current), *USR (user library list)
```

---

### IFS

#### `ibmi_get_ifs_file`
Read a file from the IFS. EBCDIC files are automatically transcoded to UTF-8; binary files are returned as base64.

```
Input:  path (string)
Output: { path, content, size, encoding }
        encoding: "ccsid-NNN" | "base64-binary" | "utf-8-fallback"
Example: ibmi_get_ifs_file("/home/MYUSER/scripts/deploy.sh")
```

#### `ibmi_list_ifs_directory`
List contents of an IFS directory.

```
Input:  path (string)
Output: { path, total, entries: [{ name, type, path, size, lastModified, owner }] }
Example: ibmi_list_ifs_directory("/home/MYUSER")
```

---

### SQL & Data

#### `ibmi_run_sql`
Run a read-only SQL SELECT query against DB2 for i. Supports offset pagination.

```
Input:  query (string), maxRows? (number, default 100, max 1000), offset? (number, default 0)
Output: { rows, columns, rowCount, offset, hasMore }
Note:   Only SELECT, WITH (CTEs), and VALUES statements are permitted.
        On V7R6+ use TABLE() wrapper: FROM TABLE(QSYS2.func(...)) — auto-retried on SQL0104.
Example: ibmi_run_sql("SELECT * FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DK'")
         ibmi_run_sql("SELECT * FROM DK.CUSTMST", maxRows=50, offset=100)
```

#### `ibmi_get_data_area`
Read the current value and attributes of an IBM i data area (`*DTAARA`).

```
Input:  library (string), name (string)
Output: { library, name, value, dataType, length, description }
        dataType: *CHAR | *DEC | *LGL
Example: ibmi_get_data_area("DK", "RUNMODE")
```

---

### Jobs & Diagnostics

#### `ibmi_get_job_log`
Retrieve job log messages. Supports severity and message type filtering, configurable message count, and optional timestamps. Falls back to the QPJOBLOG spool file for ended jobs.

```
Input:  job? (NUMBER/USER/NAME, or omit for current job),
        minSeverity? (number, e.g. 30 for warnings, 40 for errors),
        messageType? (string: *ESCAPE | *DIAG | *COMP | *INFO | *NOTIFY | *REQUEST | *STATUS),
        maxMessages? (number, default 100, max 500),
        includeTimestamp? (boolean, default false)
Output: { total, messages: [{ id, text, secondLevelText?, severity?, type?, sendTime? }] }
Example: ibmi_get_job_log()
         ibmi_get_job_log("123456/MYUSER/BATCH", minSeverity=40, messageType="*ESCAPE")
         ibmi_get_job_log("123456/MYUSER/BATCH", includeTimestamp=true, maxMessages=200)
```

#### `ibmi_find_jobs`
Search for IBM i jobs by name pattern, user, subsystem, and status.

```
Input:  jobname (string, trailing * wildcard supported),
        username? (string), status? ("ACTIVE" | "OUTQ" | "ALL"),
        subsystem? (string, e.g. QBATCH, QINTER — active jobs only),
        date_from? (YYYY-MM-DD), date_to? (YYYY-MM-DD)
Output: { total, jobs: [{ job_number, job_user, job_name, status, end_time, completion_code, subsystem }] }
Example: ibmi_find_jobs("PPLPMENV*", status="ALL")
         ibmi_find_jobs("BATCH*", subsystem="QBATCH", status="ACTIVE")
         ibmi_find_jobs("PPECPRC", username="ADMIN", status="OUTQ", date_from="2026-06-01")
```

#### `ibmi_list_spool_files`
List spool file metadata for a job or user — without fetching content. Use this to discover available spool files before calling `ibmi_get_spool_file`.

```
Input:  job? (NUMBER/USER/NAME), username? (string), splfname? (string), maxFiles? (number, default 50, max 200)
Output: { total, spoolFiles: [{ job, splfname, splfnbr, status, pages, createTime, outputQueue, outputQueueLibrary }] }
Example: ibmi_list_spool_files(job="899342/ADMIN/PPECPRC")
         ibmi_list_spool_files(username="ADMIN", splfname="QPJOBLOG")
```

#### `ibmi_get_spool_file`
Retrieve spool file content from an active or completed job. Supports line-range retrieval for large files.

```
Input:  job (NUMBER/USER/NAME), splfname (string), splfnbr? (number),
        startLine? (number, 1-based, default 1), lineCount? (number, default all)
Output: { job, splfname, splfnbr, content, startLine, returnedLines, totalLines }
Example: ibmi_get_spool_file("899342/ADMIN/PPECPRC", "QPJOBLOG")
         ibmi_get_spool_file("899342/ADMIN/PPECPRC", "QPJOBLOG", startLine=100, lineCount=200)
```

#### `ibmi_run_cl_command`
Run a read-only CL command. CPYSPLF is also permitted when writing to `TOFILE(*TOSTMF)` with a path under `/tmp/`.

```
Input:  command (string)
Output: { output, stderr?, exitCode }
Allowed prefixes (configurable): DSP, LST, WRK, CHK, PRT, DMP, RTV, QRY
Also allowed: CPYSPLF FILE(...) TOFILE(*TOSTMF) ... TOSTMF('/tmp/...')
Example: ibmi_run_cl_command("DSPFD FILE(DK/CUSTMST)")
         ibmi_run_cl_command("WRKACTJOB SBS(QBATCH)")
```

---

### Editor (VS Code)

These tools operate on files open in the VS Code editor. They work without an IBM i connection.

#### `ibmi_get_active_editor`
Read the content and metadata of the currently focused editor.

```
Input:  (none)
Output: { scheme, library?, spf?, member?, ifsPath?, filePath?, content, isDirty, lineCount }
```

#### `ibmi_list_open_editors`
List all visible editor tabs with URI, member/IFS info, and dirty state.

```
Input:  (none)
Output: Array of { uri, scheme, library?, spf?, member?, ifsPath?, filePath?, isDirty, lineCount, isActive }
```

#### `ibmi_replace_in_active_editor`
Surgical find-and-replace in the active editor — preferred for single-location changes.
The `oldText` must be unique in the document. Returns the 1-based line number where the replacement was made.
SRCDAT-safe: only the changed line gets a new date.

```
Input:  oldText (string, must be unique in the file), newText (string)
Output: { success, uri, replacedAtLine }
```

#### `ibmi_update_active_editor`
Replace the full content of the active editor and save. Use only when multiple non-contiguous lines change at once; prefer `ibmi_replace_in_active_editor` for single-location changes.

```
Input:  content (string — use real newline characters, not escaped \n sequences)
Output: { success, uri }
```

#### `ibmi_update_editor_by_uri`
Replace the full content of a specific open editor (identified by URI from `ibmi_list_open_editors`) and save.

```
Input:  uri (string), content (string — use real newline characters)
Output: { success, uri }
```

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `ibm-iagentx.preferredPort` | `41927` | HTTP port for the MCP server; falls back to next 4 ports if busy |
| `ibm-iagentx.sqlMaxRows` | `100` | Default max rows returned by `ibmi_run_sql` (1–1000) |
| `ibm-iagentx.clAllowedPrefixes` | `["DSP","LST","WRK","CHK","PRT","DMP","RTV","QRY"]` | CL verb prefixes permitted by `ibmi_run_cl_command` |
| `ibm-iagentx.bobAppDataFolder` | `""` | App data folder name used by IBM Bob (e.g. `IBMBob`). Leave blank to disable Bob auto-configuration |

---

## Troubleshooting

**Claude Code doesn't see the IBM i tools**
1. Check the status bar — must show `✓ iAgentX :NNNNN`
2. Click the status bar item → **Refresh iAgentX config**
3. Start a new Claude Code session

**`No active IBM i connection` error**
Open Code for IBM i and connect: `Ctrl+Shift+P` → `IBM i: Connect`

**Status bar shows `⚠ iAgentX`**
IBM i is disconnected. Editor tools still work. Reconnect via Code for IBM i and the icon returns to `✓` automatically.

**Port changed / wrong URL in config**
Click the status bar item → **Refresh iAgentX config**, then restart Claude Code.

**`ibmi_run_sql` rejects a statement**
Only `SELECT`, `WITH` (CTEs), and `VALUES` are allowed. DML and DDL are blocked.

**SQL0104 error on table functions**
Use the `TABLE()` wrapper: `FROM TABLE(QSYS2.func(...))` instead of `FROM QSYS2.func(...)`.
The tool auto-retries once with the wrapper, but writing it correctly avoids the round-trip.

**CL command rejected**
Add the verb prefix to `ibm-iagentx.clAllowedPrefixes` in VS Code settings.

---

## Architecture

```
Claude Code (CLI)  /  GitHub Copilot Chat  /  IBM Bob
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

- Read tools are **read-only** — no write, delete, or compile operations
- Editor tools only modify files **open in the editor** — no blind remote writes
- `ibmi_run_sql` rejects anything that is not SELECT/WITH/VALUES
- `ibmi_run_cl_command` enforces a configurable verb-prefix allowlist; CPYSPLF is only permitted with `TOFILE(*TOSTMF)` and a destination under `/tmp/`
- `ibmi_get_spool_file` copies to a temp path under `/tmp/` and deletes after reading
- No credentials stored — piggybacks on Code for IBM i's SSH session
- MCP HTTP server binds to loopback (`127.0.0.1`) only

---

## License

MIT

---

[GitHub: Duvaragesh/ibm-iagentx](https://github.com/Duvaragesh/ibm-iagentx)
