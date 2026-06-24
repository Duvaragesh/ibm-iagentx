# Changelog

All notable changes to **iAgentX for IBM i** are documented here.

## [0.0.1] - 2026-06-24

Initial release of **iAgentX for IBM i** (`iagentx4i`) on the VS Code Marketplace and Open VSX Registry.

### Added

**Zero-setup AI integration**
- Auto-configures Claude Code (`~/.claude.json`), GitHub Copilot Chat (`mcp.json`), and IBM Bob on first extension activation — no manual MCP setup required.
- Single shared MCP server bound to `127.0.0.1:41927`; secondary VS Code windows reuse the running instance automatically (shared mode).
- Status bar item shows server state and IBM i connection status; clicking opens a Quick Pick menu to Start / Stop / Restart / Refresh the server config.

**29 purpose-built IBM i tools**

*Connection*
- **`ibmi_connection_status`** — returns active IBM i connection details, OS version, and a full list of available tools so AI agents can load all schemas in a single request.

*Source Members & Objects*
- **`ibmi_get_source_member`** — retrieve the full content of an IBM i source member.
- **`ibmi_list_source_members`** — list members in a source physical file with type and last-modified date.
- **`ibmi_list_source_files`** — list source physical files in a library.
- **`ibmi_search_source_members`** — full-text search across all members in a source physical file; supports optional member filter and result limit.
- **`ibmi_list_objects`** — list objects in a library filtered by type and optional name pattern.
- **`ibmi_get_object_info`** — detailed attributes of a single IBM i object (type, owner, size, timestamps).
- **`ibmi_check_object`** — lightweight `{ exists: true/false }` existence check for any object.
- **`ibmi_get_program_info`** — attributes and bound modules for a `*PGM` or `*SRVPGM`.
- **`ibmi_get_file_fields`** — field definitions for a physical or logical file via `QSYS2.SYSCOLUMNS2`.
- **`ibmi_get_library_list`** — current library list ordered by position and type.

*IFS*
- **`ibmi_get_ifs_file`** — read an IFS file as text; EBCDIC files are transcoded by DB2, binary files returned as base64.
- **`ibmi_list_ifs_directory`** — list contents of an IFS directory.
- **`ibmi_search_ifs`** — recursive text search across an IFS directory tree with optional filename glob and case-sensitive toggle.

*SQL & Data*
- **`ibmi_run_sql`** — run read-only `SELECT` / `WITH` / `VALUES` queries against DB2 for i; supports pagination via `offset` and `maxRows`.
- **`ibmi_get_data_area`** — read the value and attributes of an IBM i data area (`*DTAARA`).

*Jobs & Diagnostics*
- **`ibmi_get_job_log`** — retrieve job log messages; filterable by message type with optional timestamps and result limit; falls back to `QPJOBLOG` spool file for ended jobs.
- **`ibmi_find_jobs`** — search for IBM i jobs by name pattern, user, status, and subsystem.
- **`ibmi_list_spool_files`** — list spool file metadata for a job or user.
- **`ibmi_get_spool_file`** — retrieve the text content of a spool file with optional line-range pagination.
- **`ibmi_get_output_queue_info`** — list spool files on an output queue filtered by status.
- **`ibmi_run_cl_command`** — run read-only CL commands (allowlisted display/diagnostic verb prefixes only).

*Users & Messages*
- **`ibmi_list_user_profiles`** — list IBM i user profiles with status, class, last sign-on, and password expiry; supports name filter and status filter.
- **`ibmi_get_message_description`** — retrieve first- and second-level text for an IBM i message ID from any message file.

*VS Code Editor*
- **`ibmi_get_active_editor`** — read the content and metadata of the currently focused VS Code editor.
- **`ibmi_list_open_editors`** — list all visible editor tabs with URI, IBM i library/member info, and dirty state.
- **`ibmi_update_active_editor`** — replace and save the entire content of the active editor back to IBM i or disk; SRCDAT-safe (only changed lines get a new source date).
- **`ibmi_update_editor_by_uri`** — replace and save a specific open editor identified by its URI.
- **`ibmi_replace_in_active_editor`** — surgical find-and-replace on the active editor; pass only `oldText` (must be unique) and `newText` — no need to send the full file.

**Security model**
- All IBM i access runs under the user's own profile via Code for IBM i's existing SSH session — no service accounts or stored credentials.
- SQL is strictly read-only: `INSERT`, `UPDATE`, `DELETE`, and DDL are blocked at the extension layer.
- CL commands are allowlisted to display/diagnostic verb prefixes (`DSP`, `LST`, `WRK`, `CHK`, `PRT`, `DMP`, `RTV`, `QRY`).
- Editor write tools operate only on files already open in VS Code — the AI cannot open and overwrite arbitrary source members.
- MCP server binds exclusively to `127.0.0.1` — unreachable from any other machine on the network.
