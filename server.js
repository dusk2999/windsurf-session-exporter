const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const https = require('https');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIBS_DIR = path.join(PUBLIC_DIR, 'libs');
const EXPORTS_DIR = path.join(__dirname, 'exports');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// CDN resources to download for offline-ready premium UI elements
const LIBS_TO_DOWNLOAD = [
  {
    name: 'marked.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js'
  },
  {
    name: 'purify.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js'
  },
  {
    name: 'prism.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'
  },
  {
    name: 'prism.css',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css'
  }
];

// Helper: Ensure directories exist
function ensureDirs() {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
  if (!fs.existsSync(LIBS_DIR)) fs.mkdirSync(LIBS_DIR);
  if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR);
}

// Helper: Download a file with timeout
function downloadFile(url, dest, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server returned status code ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
      fileStream.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });

    req.on('error', reject);

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

// Check and download library dependencies for offline rendering
async function prepareDependencies() {
  ensureDirs();
  console.log('[Setup] Checking client-side libraries...');
  for (const lib of LIBS_TO_DOWNLOAD) {
    const destPath = path.join(LIBS_DIR, lib.name);
    if (!fs.existsSync(destPath)) {
      console.log(`[Setup] Downloading ${lib.name} from CDN...`);
      try {
        await downloadFile(lib.url, destPath);
        console.log(`[Setup] Successfully downloaded ${lib.name}`);
      } catch (err) {
        console.warn(`[Setup] Failed to download ${lib.name}: ${err.message}. Offline fallback will be active.`);
      }
    }
  }
  console.log('[Setup] Library preparation complete.');
}

// Helper: Run PowerShell command and return output
function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    let cmd = '$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
    
    if (args[0] === '-Command') {
      cmd += args[1];
    } else if (args[0] === '-File') {
      const scriptPath = args[1];
      const escapedScriptPath = scriptPath.replace(/'/g, "''");
      cmd += `& '${escapedScriptPath}'`;
      
      for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (typeof arg === 'string') {
          if (arg.startsWith('-')) {
            cmd += ` ${arg}`;
          } else {
            const escapedVal = arg.replace(/'/g, "''");
            cmd += ` '${escapedVal}'`;
          }
        } else {
          cmd += ` ${arg}`;
        }
      }
    } else {
      cmd += args.join(' ');
    }

    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', cmd
    ]);

    let stdoutChunks = [];
    let stderrChunks = [];

    ps.stdout.on('data', (data) => {
      stdoutChunks.push(data);
    });

    ps.stderr.on('data', (data) => {
      stderrChunks.push(data);
    });

    ps.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Serve static file
function serveStaticFile(reqPath, res) {
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);
  
  // Security check: ensure path is inside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.statusCode = 200;

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

// API router
async function handleApi(req, res) {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // 1. Get process status
    if (pathname === '/api/status') {
      try {
        const psScript = 'Get-Process language_server_windows_x64 -ErrorAction SilentlyContinue | Select-Object Id, Name, Path | ConvertTo-Json';
        const stdout = await runPowerShell(['-Command', psScript]);
        if (stdout) {
          res.end(stdout);
        } else {
          res.end(JSON.stringify({ error: 'Windsurf Language Server process is not running.' }));
        }
      } catch (err) {
        res.end(JSON.stringify({ error: 'Could not fetch process status: ' + err.message }));
      }
      return;
    }

    // 2. List sessions
    if (pathname === '/api/sessions') {
      const limit = parsedUrl.searchParams.get('limit') || '50';
      try {
        const scriptPath = path.join(__dirname, 'Export-WindsurfSession.ps1');
        const output = await runPowerShell(['-File', scriptPath, '-List', '-AsJson', '-Limit', limit]);
        res.end(output);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. Get session detail / parse session
    if (pathname === '/api/session') {
      const id = parsedUrl.searchParams.get('id');
      const includeTools = parsedUrl.searchParams.get('includeTools') === 'true';
      if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid or missing CascadeId' }));
        return;
      }

      try {
        const scriptPath = path.join(__dirname, 'Export-WindsurfSession.ps1');
        const args = ['-File', scriptPath, '-CascadeId', id, '-JsonOnly', '-AsJson'];
        if (includeTools) {
          args.push('-IncludeTools');
        }

        const runResultText = await runPowerShell(args);
        let results = JSON.parse(runResultText);
        if (results && !Array.isArray(results)) {
          results = [results];
        }
        
        if (results && results.length > 0 && results[0].Json) {
          const jsonFilePath = results[0].Json;
          if (fs.existsSync(jsonFilePath)) {
            const fileContent = fs.readFileSync(jsonFilePath, 'utf8');
            res.end(fileContent);
          } else {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Export completed but JSON output file was not found on disk.' }));
          }
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Export failed: No file path returned from script.' }));
        }
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3.5 Export all action
    if (pathname === '/api/export-all' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          let includeTools = false;
          if (body.trim()) {
            try {
              const payload = JSON.parse(body);
              includeTools = payload.includeTools;
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
              return;
            }
          }

          const scriptPath = path.join(__dirname, 'Export-WindsurfSession.ps1');
          const args = ['-File', scriptPath, '-All', '-AsJson'];
          
          if (includeTools) {
            args.push('-IncludeTools');
          }

          const runResultText = await runPowerShell(args);
          let results;
          try {
            results = JSON.parse(runResultText);
          } catch (jsonErr) {
            console.error('[Error] /api/export-all JSON parse failed. Length:', runResultText.length);
            fs.writeFileSync(path.join(__dirname, 'debug_runResultText.txt'), runResultText);
            throw jsonErr;
          }
          if (results && !Array.isArray(results)) {
            results = [results];
          }
          res.end(JSON.stringify(results));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 4. Export action
    if (pathname === '/api/export' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const { id, format, includeTools } = payload;
          if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid CascadeId' }));
            return;
          }

          const scriptPath = path.join(__dirname, 'Export-WindsurfSession.ps1');
          const args = ['-File', scriptPath, '-CascadeId', id, '-AsJson'];
          
          if (format === 'markdown') {
            args.push('-MarkdownOnly');
          } else if (format === 'json') {
            args.push('-JsonOnly');
          }

          if (includeTools) {
            args.push('-IncludeTools');
          }

          const runResultText = await runPowerShell(args);
          let results = JSON.parse(runResultText);
          if (results && !Array.isArray(results)) {
            results = [results];
          }
          res.end(JSON.stringify(results));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 5. Open exports folder in Explorer
    if (pathname === '/api/open-folder' && req.method === 'POST') {
      exec(`explorer.exe "${EXPORTS_DIR}"`, (err) => {
        if (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Could not open directory: ' + err.message }));
        } else {
          res.end(JSON.stringify({ success: true, path: EXPORTS_DIR }));
        }
      });
      return;
    }

    // 6. Direct file download
    if (pathname === '/api/download') {
      const filePathParam = parsedUrl.searchParams.get('path');
      if (!filePathParam) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing path parameter' }));
        return;
      }

      // Security check: resolve the path and verify it is strictly inside EXPORTS_DIR
      const resolvedPath = path.resolve(filePathParam);
      const relative = path.relative(EXPORTS_DIR, resolvedPath);
      const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

      if (!isSafe) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Forbidden: Can only download from exports directory.' }));
        return;
      }

      fs.stat(resolvedPath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'File not found.' }));
          return;
        }

        const fileName = path.basename(resolvedPath);
        res.statusCode = 200;
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(resolvedPath).pipe(res);
      });
      return;
    }

    // Default 404 for API
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'API endpoint not found' }));

  } catch (globalErr) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Internal Server Error: ' + globalErr.message }));
  }
}

// Start Server
async function main() {
  await prepareDependencies();

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (parsedUrl.pathname.startsWith('/api')) {
      handleApi(req, res);
    } else {
      serveStaticFile(parsedUrl.pathname, res);
    }
  });

  let currentPort = PORT;

  function listen(port) {
    server.removeAllListeners('error');
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Server] Port ${port} is in use, trying port ${port + 1}...`);
        listen(port + 1);
      } else {
        console.error('[Server] Server error:', err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const serverUrl = `http://localhost:${port}`;
      console.log(`[Server] Dashboard running at: ${serverUrl}`);
      console.log('[Server] Spawning browser window...');
      exec(`start ${serverUrl}`);
    });
  }

  listen(currentPort);
}

main().catch(err => {
  console.error('[Error] Server startup failed:', err);
  process.exit(1);
});
