# IBM iAgentX

**Bring your IBM i system into VS Code AI agents — GitHub Copilot Chat, Claude Code, and IBM Bob.**

IBM iAgentX exposes IBM i resources (source members, IFS files, SQL, job logs, CL commands)
to AI coding agents via the Model Context Protocol (MCP). It reuses the active SSH connection
managed by [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi)
— no second connection, no extra credentials.

---

## What you can do

Ask your AI agent to:

- Read and review source members (RPG, CL, COBOL, DDS, …)
- Browse IFS files and directories
- Query DB2 for i with plain SQL
- Pull job log messages by job ID or current job
- Run read-only CL commands (DSPFD, WRKACTJOB, …)

Everything happens through the existing Code for IBM i SSH session.

---

## Requirements

- VS Code 1.99 or later
- [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi) — installed and connected to an IBM i system
- One or more of the supported AI agents:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - GitHub Copilot Chat (built into VS Code)
  - IBM Bob

---

## Installation

Install from the Marketplace or via the command line:

```bash
code --install-extension Duvaragesh.ibm-iagentx
```

No manual configuration required — the extension auto-configures Claude Code and VS Code
on first activation.

---

## Setup

### Claude Code

On first activation the extension writes its MCP server URL into `~/.claude.json`
automatically. Start a new Claude Code session and the IBM i tools are ready.

### GitHub Copilot Chat

The extension registers itself via VS Code's MCP provider API and writes to
`%APPDATA%/Code/User/mcp.json` (Windows) or the platform equivalent.
Copilot Chat picks this up without any manual steps.

### IBM Bob

IBM Bob reads the same `mcp.json` entry — no extra configuration needed.

---

## Available Tools

| Tool | Description |
|---|---|
| `ibmi_connection_status` | Check whether an IBM i connection is active |
| `ibmi_get_source_member` | Read the full source of a library/SPF/member |
| `ibmi_list_source_members` | List members in a source physical file |
| `ibmi_list_source_files` | List all source physical files in a library |
| `ibmi_get_ifs_file` | Read a file from the IFS |
| `ibmi_list_ifs_directory` | List contents of an IFS directory |
| `ibmi_run_sql` | Run a read-only SQL query against DB2 for i |
| `ibmi_get_job_log` | Retrieve job log messages (by job ID or current job) |
| `ibmi_run_cl_command` | Run a read-only CL command |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `ibm-iagentx.preferredPort` | `41927` | HTTP port for the MCP server; falls back to next 4 ports if busy |
| `ibm-iagentx.sqlMaxRows` | `100` | Default max rows returned by `ibmi_run_sql` (1–1000) |
| `ibm-iagentx.clAllowedPrefixes` | `["DSP","LST","WRK","CHK","PRT","DMP","RTV","QRY"]` | CL verb prefixes permitted by `ibmi_run_cl_command` |

---

## Status Bar

| Display | Meaning |
|---|---|
| `⟳ iAgentX` | Server is starting |
| `✓ iAgentX :41927` | Running — click to reconnect |
| `✗ iAgentX` | Failed to bind any port |

Click the status bar item (or run **IBM iAgentX: Reconnect** from the Command Palette)
to re-write config files with the current port.

---

## Security

- All tools are **read-only** — no write, delete, or compile operations
- `ibmi_run_sql` only accepts SELECT, WITH (CTEs), and VALUES statements
- `ibmi_run_cl_command` enforces a configurable verb-prefix allowlist
- No credentials stored — piggybacks on Code for IBM i's SSH session
- MCP server binds to loopback (`127.0.0.1`) only — never reachable from outside your machine

---

## Troubleshooting

**Claude Code doesn't see the IBM i tools**
1. Check the status bar — must show `✓ iAgentX :NNNNN`
2. Click the status bar item to reconnect
3. Start a new Claude Code session

**`No active IBM i connection` error**
Open Code for IBM i and connect: `Ctrl+Shift+P` → `IBM i: Connect`

**Port changed between restarts**
Click the status bar item — the extension rewrites the config files with the current port,
then restart Claude Code.

---

## License

MIT — [GitHub: Duvaragesh/ibm-iagentx](https://github.com/Duvaragesh/ibm-iagentx)
