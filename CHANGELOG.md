# Changelog

All notable changes to IBM iAgentX are documented here.

## [0.2.1] - 2026-06-17

### Added

**7 new IBM i object and catalog tools:**

- **`ibmi_list_objects`** — lists objects in a library filtered by type (`*FILE`, `*PGM`, `*SRVPGM`, `*CMD`, `*DTAARA`, `*ALL`, etc.) and optional name pattern (trailing `*` wildcard). Returns up to 500 objects with name, type, attribute, owner, size, and last-used timestamp. Sourced from `QSYS2.OBJECT_STATISTICS`.
- **`ibmi_get_object_info`** — detailed attributes of a single IBM i object: type, attribute, owner, size, creation time, last-modified time, and last-used time. Returns `{ exists: false }` when the object is not found — never throws, making it safe to use as a pre-check.
- **`ibmi_check_object`** — lightweight existence check for any IBM i object. Returns `{ exists: true/false }` without throwing. Preferred over `ibmi_get_object_info` when only existence matters.
- **`ibmi_get_data_area`** — reads the current value and attributes of an IBM i data area (`*DTAARA`) using `QSYS2.DATA_AREA_INFO`. Returns value as a string for all types (`*CHAR`, `*DEC`, `*LGL`), along with type and length.
- **`ibmi_list_spool_files`** — lists spool file metadata for a job or user without fetching content. Accepts optional `job` (NUMBER/USER/NAME), `username`, `splfname`, and `maxFiles` (up to 200). Useful for discovering available spool files before calling `ibmi_get_spool_file`.
- **`ibmi_get_file_fields`** — returns field definitions for an IBM i physical or logical file via `QSYS2.SYSCOLUMNS2`. Each field includes name, SQL type, length, precision/scale, nullability, default value, IBM i text description, and ordinal position.
- **`ibmi_get_library_list`** — returns the current library list ordered by position via `QSYS2.LIBRARY_LIST_INFO`. Includes system (`*SYS`), product (`*PROD`), current (`*CUR`), and user (`*USR`) library types.

**3 new shared utility modules (`src/utils/`):**

- **`normaliseLineEndings.ts`** — extracted from `mcpServer.ts` for reuse across tools.
- **`ccsidCast.ts`** — `castUtf8(expr, maxLen?)` helper that wraps a SQL column in `CAST(... AS VARCHAR(N) CCSID 1208)` to force UTF-8 transcoding of EBCDIC catalog text columns (used in `ibmi_get_file_fields`).
- **`qsysPath.ts`** — `getQSYSObjectPath(library, name, type, member?, iasp?)` builds IFS-style `/QSYS.LIB/...` paths for IBM i objects.

### Improved

- **`ibmi_get_job_log`** — three new optional parameters:
  - `messageType` — filter by message type (`*ESCAPE`, `*DIAG`, `*COMP`, `*INFO`, `*NOTIFY`, etc.)
  - `maxMessages` — control how many messages to return (default 100, max 500)
  - `includeTimestamp` — when `true`, each message includes a `sendTime` ISO timestamp
- **`ibmi_run_sql`** — new `offset` parameter for pagination. Response now includes `offset` (echoed back) and `hasMore` (boolean indicating whether additional rows exist beyond the current page).
- **`ibmi_get_spool_file`** — new `startLine` (1-based) and `lineCount` parameters for partial retrieval of large spool files. Response now includes `totalLines`, `returnedLines`, and `startLine` so agents can paginate through long output.
- **`ibmi_connection_status`** — now returns `osVersion` (e.g. `V7R5M0`) queried from `QSYS2.SYSTEM_STATUS_INFO`. Omitted gracefully if unsupported.
- **`ibmi_find_jobs`** — new `subsystem` parameter to filter active jobs by subsystem name (e.g. `QBATCH`, `QINTER`).
- **`ibmi_run_cl_command`** — no functional change; internal cleanup only.
- **`ibmi_connection_status`** tool description updated to list all 23 available tools.

---

## [0.2.0] - 2026-06-17

### Fixed
- **`ibmi_get_spool_file` — CPD0043 SPLFNBR not valid** (`getSpoolFile.ts`, `mcpServer.ts`) — `SPLFNBR(n)` is now only appended to the `CPYSPLF` command when the caller explicitly provides `splfnbr`. Omitting it lets IBM i default to `*LAST`, avoiding the CPD0043 error that occurred when the parameter was passed empty.
- **`ibmi_get_ifs_file` — raw EBCDIC returned as garbage** (`getIfsFile.ts`, `mcpServer.ts`) — replaced `downloadStreamfileRaw` + `toString('utf-8')` with a new `readIfsAsText()` helper (see below). EBCDIC files (e.g. spool files copied to `/tmp/`) are now transcoded by DB2 via `QSYS2.IFS_READ` before being returned. Binary files (CCSID 65535) are returned as base64 with `encoding: 'base64-binary'`. The output now includes an `encoding` field indicating how the content was decoded.
- **`ibmi_get_job_log` — EBCDIC spool fallback returned garbage** (`getJobLog.ts`, `mcpServer.ts`) — the `CPYSPLF` fallback path for ended jobs now reads the IFS file with `readIfsAsText()` instead of raw UTF-8, so the job log is legible regardless of the file's CCSID.
- **`ibmi_get_spool_file` — spool content returned as EBCDIC** (`getSpoolFile.ts`, `mcpServer.ts`) — spool files copied to `/tmp/` by `CPYSPLF` are now read with `readIfsAsText()` for consistent EBCDIC transcoding.
- **`ibmi_run_sql` — SQL0104 on table functions without `TABLE()` wrapper** (`runSql.ts`, `mcpServer.ts`) — on V7R6+ the `TABLE()` wrapper is mandatory for table functions (e.g. `FROM TABLE(QSYS2.IFS_READ(...))`). The tool now auto-detects a SQL0104 failure, rewrites bare `FROM schema.FUNC(...)` patterns to add the wrapper, and retries once transparently. The tool description also documents the requirement so AI agents write it correctly from the start.

### Added
- **`src/utils/ifsRead.ts`** — new shared helper `readIfsAsText(connection, path)` that reads an IFS file as readable text regardless of its CCSID: queries file CCSID via `QSYS2.IFS_OBJECT_STATISTICS`, returns base64 for binary (CCSID 65535), lets DB2 transcode via `QSYS2.IFS_READ` (with mandatory `TABLE()` wrapper) for all EBCDIC CCSIDs, and falls back to raw UTF-8 download as a last resort.

---

## [0.1.9] - 2026-06-17

### Fixed
- **Marketplace display** — extension overview in both VS Code IDE and the VS Code Marketplace now correctly show MARKETPLACE.md content. Previous publish used `vsce publish` directly, bypassing the `--readme-path` flag. Publishing now uses `npm run publish` which passes `--readme-path MARKETPLACE.md` to both `vsce package` and `vsce publish`.

---

## [0.1.8] - 2026-06-16

### Added
- **`ibmi_get_spool_file`** — new tool to retrieve the text content of any spool file from an active or completed IBM i job. Accepts `job` (NUMBER/USER/NAME), `splfname` (e.g. `QPJOBLOG`), and optional `splfnbr`. Uses `CPYSPLF` internally to copy to `/tmp/`, reads the content, and cleans up the temp file automatically. Returns `{ job, splfname, splfnbr, content, lineCount }`.
- **`ibmi_find_jobs`** — new tool to search for IBM i jobs by name pattern (supports trailing `*` wildcard), optional user, and status filter (`ACTIVE` / `OUTQ` / `ALL`). Active jobs are sourced from `QSYS2.ACTIVE_JOB_INFO`; ended jobs from `QSYS2.HISTORY_LOG_INFO` (CPF1164 messages). Returns job number, user, name, status, end time, completion code, and subsystem.

### Improved
- **`ibmi_get_job_log`** — now falls back to the `QPJOBLOG` spool file when the in-memory job log is unavailable (e.g. for ended jobs). Returns spool content as a single `SPOOL` message. If the spool has also been deleted, returns a clear message: "Job has ended and spool file is no longer available".
- **`ibmi_run_cl_command`** — `CPYSPLF` is now permitted as an exception to the read-only prefix whitelist, provided `TOFILE(*TOSTMF)` is specified and the destination path is under `/tmp/`. Any other destination is rejected with a clear error.

---

## [0.1.7] - 2026-06-16

### Improved
- **MARKETPLACE.md** updated to document all editor tools, new status bar states (shared, disconnected, stopped), manage menu options, multiple VS Code windows / shared server behaviour, and updated troubleshooting steps.

---

## [0.1.6] - 2026-06-16

### Added
- **`ibmi_replace_in_active_editor`** — new surgical find-and-replace tool. Pass only `oldText` (must be unique in the file) and `newText`; no need to send the entire file. Returns the 1-based line number where the replacement was made. Errors clearly if `oldText` is not found or appears more than once. SRCDAT-safe — only the changed line gets a new date.
- **Manage iAgentX server menu** — clicking the status bar now opens a Quick Pick with Start / Stop / Restart / Refresh iAgentX config options. Command also available from the Command Palette as `IBM iAgentX: Manage MCP Server`.
- **Auto IBM i connection awareness** — status bar icon automatically reflects IBM i connection state: `$(check)` when connected, `$(warning)` when disconnected (server stays running; VS Code-only tools still work). Subscribes to Code for IBM i `connected`/`disconnected` events.
- **Single shared server across VS Code windows** — on startup, secondary VS Code windows probe port 41927 first. If an iAgentX server is already running there, they enter shared mode (`$(check) iAgentX :41927 (shared)`) and reuse the existing server instead of binding a new port. Only the owning window can Stop/Restart; shared windows get Refresh only.

### Fixed
- **SRCDAT preservation** — `ibmi_update_active_editor` and `ibmi_update_editor_by_uri` no longer reset the source-date field on every record. The extension now saves through VS Code's file-system provider (same path as GitHub Copilot) instead of calling `uploadMemberContent` directly, so only changed lines receive a new date.
- **Minimal diff edit** — editor updates now apply only the changed line range rather than replacing the entire document, preventing spurious dirty markers on unchanged lines.
- **VS Code-only tools no longer require an IBM i connection** — `ibmi_get_active_editor`, `ibmi_list_open_editors`, `ibmi_update_active_editor`, and `ibmi_update_editor_by_uri` work even when no IBM i session is active.
- **Line-ending corruption** — if an AI agent passed literal `\r\n` escape sequences instead of real newlines, the extension now auto-corrects them before writing, preventing the entire file from collapsing into a single line.
- **"No active editor" error** — `vscode.window.activeTextEditor` returns `undefined` when focus moves to the terminal or chat panel. The extension now tracks the last focused editor via `onDidChangeActiveTextEditor` and falls back to it, so editor tools work even after clicking away to type a prompt.
- **Uninstall no longer removes Code for IBM i** — changed `extensionPack` to `extensionDependencies` in the manifest so iAgentX can be uninstalled independently without prompting to remove Code for IBM i, Db2 for IBM i, and the IBM i filesystem extension.

### Improved
- **`ibmi_connection_status`** description now lists all 14 available tool names, allowing AI agents to load all needed schemas in a single `ToolSearch` call upfront instead of sequentially.
- **`ibmi_get_active_editor`** description now guides AI agents to prefer `ibmi_replace_in_active_editor` for small changes after reading.
- **`ibmi_update_active_editor`** description now explicitly says to use it only when multiple non-contiguous lines change; single-location changes should use `ibmi_replace_in_active_editor`.
- Tool descriptions for `ibmi_update_active_editor` and `ibmi_update_editor_by_uri` now explicitly instruct AI agents to use real newline characters in the `content` parameter.

## [0.1.5] - 2026-06-15

### Added
- `ibmi_update_active_editor` — replace and save the content of the currently focused VS Code editor back to IBM i or disk.
- `ibmi_update_editor_by_uri` — replace and save a specific open editor identified by its URI (from `ibmi_list_open_editors`).
- `ibmi_get_active_editor` — read the content and metadata of the currently focused editor.
- `ibmi_list_open_editors` — list all visible editor tabs with URI, library/member info, and dirty state.

## [0.1.4] - Initial releases

### Added
- `ibmi_get_source_member` — retrieve full source of an IBM i source member.
- `ibmi_list_source_members` — list members in a source physical file.
- `ibmi_list_source_files` — list source physical files in a library.
- `ibmi_get_ifs_file` — read a file from the IFS.
- `ibmi_list_ifs_directory` — list contents of an IFS directory.
- `ibmi_run_sql` — run read-only SQL SELECT queries against DB2 for i.
- `ibmi_get_job_log` — retrieve job log messages.
- `ibmi_run_cl_command` — run read-only CL commands.
- `ibmi_connection_status` — check active IBM i connection details.
- Auto-registration with `~/.claude.json` (Claude Code) and `mcp.json` (VS Code / Copilot) on startup.
- Status bar item showing server port with reconnect command.
