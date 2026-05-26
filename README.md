# Windsurf Session Exporter

Exports local Windsurf Cascade/Agent sessions through Windsurf's own local language-server RPC, then cleans the transcript into readable Markdown and JSON.

## What It Does

- Finds the running `language_server_windows_x64.exe`.
- Detects the local RPC port.
- Uses the local CSRF value from the language-server process environment.
- Calls `GetAllCascadeTrajectories` and `GetCascadeTranscriptForTrajectoryId`.
- Drops tool/system step noise by default, keeping only `User` and `Assistant` messages.

It does not print Windsurf auth tokens or API keys.

## Usage

Run these from this folder:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -List -Limit 20
```

Export the most recently modified session:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1
```

Export one session:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "86f62e25-f2e5-4d3f-9513-b65bc750e117"
```

Export all sessions:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -All
```

Include tool steps as well:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "<cascade-id>" -IncludeTools
```

Outputs go to `.\exports` by default. Use `-OutDir` to choose another directory.

## Web UI Dashboard 🖥️

We have packaged a beautiful, premium, glassmorphism-designed Web UI to manage, preview, and export your sessions interactively.

### How to Run:
Simply double-click `start.bat` in this folder, or run:
```bash
node server.js
```
This will start a local server, prepare the client-side dependencies (for offline use), and automatically open the dashboard in your default browser (usually at `http://localhost:3000` or the next free port).

### UI Features:
- **Interactive Sidebar**: Shows all sessions with status, steps count, and modification times, plus a search bar (`Ctrl+K` to focus) to instantly filter sessions.
- **Rich Message View**: Displays User and Assistant messages in a clean chat style. Code syntax highlighting is automatically applied, and each code block features a quick-copy button.
- **Dynamic Noise Filtering**: A toggle switch lets you include or exclude Tool execution noise on the fly.
- **One-click Export**: Generate Markdown or JSON directly from the UI, with immediate download.
- **Batch Export**: A dedicated button lets you batch export all sessions sequentially with a visual progress HUD.

