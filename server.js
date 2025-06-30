const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 8000;

// Initialize Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Set environment for production optimization
app.set('env', process.env.NODE_ENV || 'development');

// Security middleware with tightened CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://deepllm.glitch.me"]
    }
  }
}));

app.use(compression());

// CORS configuration to accept requests only from https://example.com
app.use(cors({
  origin: 'https://deepllm.glitch.me',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit to 50 requests per window
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: false, limit: '5mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  logger.info(`Request received: ${req.method} ${req.path} [ID: ${req.id}]`);
  next();
});

// Temporary directory for Python files
const TEMP_DIR = path.join(__dirname, 'temp');
(async () => {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir('logs', { recursive: true });
    logger.info('Initialized temp and logs directories');
  } catch (error) {
    logger.error(`Failed to initialize directories: ${error.message}`);
  }
})();

// Store download tokens with file info
const downloadTokens = new Map();
const serverStartTime = Date.now();

// Generate download token
const generateDownloadToken = (filePath, execDir) => {
  const token = uuidv4();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  downloadTokens.set(token, { filePath, execDir, expires });
  logger.info(`Generated download token: ${token}`);
  return token;
};

// Clean up expired tokens and directories
const cleanupExpiredFiles = async () => {
  const now = Date.now();
  for (const [token, { filePath, execDir, expires }] of downloadTokens) {
    if (now > expires) {
      try {
        await fs.rm(execDir, { recursive: true, force: true });
        downloadTokens.delete(token);
        logger.info(`Cleaned up expired directory: ${execDir}`);
      } catch (error) {
        logger.error(`Cleanup failed for ${execDir}: ${error.message}`);
      }
    }
  }
};

// Run cleanup every minute
setInterval(cleanupExpiredFiles, 60 * 1000);

// Execute Python command
const executeCommand = (command, timeout = 30000, allowNetwork = false, cwd) => {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (!allowNetwork) {
      delete env['HTTP_PROXY'];
      delete env['HTTPS_PROXY'];
      delete env['http_proxy'];
      delete env['https_proxy'];
    }

    exec(command, { timeout, env, cwd }, (error, stdout, stderr) => {
      const filteredStderr = stderr && typeof stderr === 'string'
        ? stderr.split('\n')
            .filter(line => 
              !line.includes('DEPRECATION') && 
              !line.includes('Python 2.7') &&
              !line.includes('WARNING') &&
              line.trim().length > 0
            )
            .join('\n')
        : stderr;

      if (error) {
        reject({ error: error.message, stderr: filteredStderr });
      } else {
        resolve(stdout);
      }
    });
  });
};

// Root route - JSON response only
app.get('/', (req, res) => {
  res.json({
    message: 'Python Code Executor Server is running!',
    status: 'healthy',
    endpoints: {
      'GET /health': 'Server health check',
      'POST /execute': 'Execute Python code',
      'GET /download/:token': 'Download generated file',
      'GET /api': 'API information'
    }
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const pythonVersion = await executeCommand('python --version', 5000);
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
    
    res.json({ 
      status: 'healthy',
      pythonVersion: pythonVersion.trim(),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      tempDir: TEMP_DIR,
      uptime: uptime,
      activeDownloads: downloadTokens.size,
      timestamp: new Date().toISOString()
    });
    logger.info('Health check successful');
  } catch (error) {
    logger.error(`Health check failed: ${error.message}`);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Python not available',
      details: error.message || error.stderr,
      timestamp: new Date().toISOString()
    });
  }
});

// Download endpoint
app.get('/download/:token', async (req, res) => {
  const { token } = req.params;
  const downloadInfo = downloadTokens.get(token);

  if (!downloadInfo) {
    const errorPage = path.join(__dirname, '404.html');
    logger.error(`Invalid or expired download token: ${token}`);
    return fsSync.existsSync(errorPage) 
      ? res.status(404).sendFile(errorPage)
      : res.status(404).json({ error: 'Invalid or expired download token' });
  }

  const { filePath, execDir, expires } = downloadInfo;
  
  if (Date.now() > expires) {
    downloadTokens.delete(token);
    try {
      await fs.rm(execDir, { recursive: true, force: true });
      logger.info(`Cleaned up expired download directory: ${execDir}`);
    } catch (error) {
      logger.error(`Cleanup failed for ${execDir}: ${error.message}`);
    }
    const errorPage = path.join(__dirname, '404.html');
    return fsSync.existsSync(errorPage) 
      ? res.status(410).sendFile(errorPage)
      : res.status(410).json({ error: 'Download link has expired' });
  }

  try {
    await fs.access(filePath);
    const filename = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Stream file to reduce memory usage
    const fileStream = fsSync.createReadStream(filePath);
    fileStream.pipe(res);
    fileStream.on('error', () => {
      if (!res.headersSent) {
        const errorPage = path.join(__dirname, '404.html');
        res.status(500).sendFile(errorPage);
      }
    });
    logger.info(`File download started for token: ${token}`);
  } catch (error) {
    downloadTokens.delete(token);
    try {
      await fs.rm(execDir, { recursive: true, force: true });
      logger.info(`Cleaned up directory after download error: ${execDir}`);
    } catch (cleanupError) {
      logger.error(`Cleanup failed for ${execDir}: ${cleanupError.message}`);
    }
    const errorPage = path.join(__dirname, '404.html');
    logger.error(`Download failed for token: ${token}: ${error.message}`);
    return fsSync.existsSync(errorPage) 
      ? res.status(404).sendFile(errorPage)
      : res.status(404).json({ error: 'File not found' });
  }
});

// Execute Python code
app.post('/execute', async (req, res) => {
  let execDir;
  try {
    const { code, timeout = 30, allow_network = false } = req.body;
    
    if (!code || typeof code !== 'string') {
      logger.error(`Invalid code provided for request ID: ${req.id}`);
      return res.status(400).json({ 
        error: 'No valid code provided',
        success: false 
      });
    }

    // Validate timeout (1s to 60s to save CPU)
    const timeoutMs = Math.max(1000, Math.min(parseInt(timeout) * 1000, 60000));

    // Create unique execution directory
    const execId = req.id;
    execDir = path.join(TEMP_DIR, `exec_${execId}`);
    await fs.mkdir(execDir, { recursive: true });

    // Save Python code to temporary file
    const tempFile = path.join(execDir, `script_${execId}.py`);
    await fs.writeFile(tempFile, code, 'utf8');

    // Execute Python file
    const result = await executeCommand(`python "${tempFile}"`, timeoutMs, allow_network, execDir);

    // Check for generated files
    const generatedFiles = [];
    try {
      const files = await fs.readdir(execDir);
      for (const file of files) {
        const filePath = path.join(execDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile() && file !== path.basename(tempFile)) {
          const mimeType = mime.lookup(filePath) || 'application/octet-stream';
          if (!file.endsWith('.py')) {
            const token = generateDownloadToken(filePath, execDir);
            generatedFiles.push({
              filename: file,
              downloadUrl: `/download/${token}`,
              expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              mimeType: mimeType,
              size: stats.size
            });
          }
        }
      }
    } catch (dirError) {
      logger.error(`Directory read error for exec ID: ${execId}: ${dirError.message}`);
    }

    // Clean up Python script
    try {
      await fs.unlink(tempFile);
      logger.info(`Cleaned up script file: ${tempFile}`);
    } catch (error) {
      logger.error(`Failed to clean up script file ${tempFile}: ${error.message}`);
    }
    
    res.json({ 
      output: result || 'Code executed successfully (no output)',
      success: true,
      generatedFiles,
      executionTime: new Date().toISOString()
    });
    logger.info(`Execution successful for ID: ${execId}`);

  } catch (error) {
    logger.error(`Execution failed for ID: ${req.id}: ${error.message}`);
    res.status(500).json({ 
      error: 'Error executing Python code',
      details: error.stderr || error.message,
      success: false,
      timestamp: new Date().toISOString()
    });
  } finally {
    // Clean up execution directory (except active download files)
    if (execDir) {
      try {
        const files = await fs.readdir(execDir);
        for (const file of files) {
          const filePath = path.join(execDir, file);
          const isActive = Array.from(downloadTokens.values()).some(
            tokenInfo => tokenInfo.filePath === filePath
          );
          if (!isActive) {
            await fs.unlink(filePath);
          }
        }
        const remainingFiles = await fs.readdir(execDir);
        if (remainingFiles.length === 0) {
          await fs.rmdir(execDir);
          logger.info(`Cleaned up execution directory: ${execDir}`);
        }
      } catch (cleanupError) {
        logger.error(`Cleanup failed for ${execDir}: ${cleanupError.message}`);
      }
    }
  }
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Python Code Executor API',
    version: '2.1.0',
    status: 'running',
    endpoints: {
      'GET /': 'API information',
      'GET /health': 'Server and Python health check',
      'POST /execute': 'Execute Python code',
      'GET /download/:token': 'Download generated file',
      'GET /api': 'This endpoint'
    },
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    timestamp: new Date().toISOString()
  });
  logger.info('API info requested');
});

// Error handling middleware
app.use((err, req, res, next) => {
  const errorPage = path.join(__dirname, '404.html');
  logger.error(`Server error for request ID: ${req.id}: ${err.message}`);
  if (fsSync.existsSync(errorPage)) {
    res.status(500).sendFile(errorPage);
  } else {
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  const errorPage = path.join(__dirname, '404.html');
  logger.error(`Route not found: ${req.method} ${req.path} [ID: ${req.id}]`);
  if (fsSync.existsSync(errorPage)) {
    res.status(404).sendFile(errorPage);
  } else {
    res.status(404).json({
      error: 'Not found',
      message: `Route ${req.method} ${req.path} not found`,
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }
});

// Graceful shutdown
let isShuttingDown = false;
const activeConnections = new Set();

app.use((req, res, next) => {
  if (isShuttingDown) {
    logger.warn(`Request rejected during shutdown: ${req.method} ${req.path}`);
    return res.status(503).json({ 
      error: 'Server is shutting down',
      code: 'SHUTTING_DOWN'
    });
  }
  
  activeConnections.add(req.socket);
  req.socket.on('close', () => {
    activeConnections.delete(req.socket);
  });
  
  next();
});

async function gracefulShutdown(signal) {
  isShuttingDown = true;
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  
  server.close(() => {
    const checkConnections = () => {
      if (activeConnections.size === 0) {
        logger.info('All connections closed. Exiting.');
        process.exit(0);
      } else {
        logger.info(`Waiting for ${activeConnections.size} active connections...`);
        setTimeout(checkConnections, 1000);
      }
    };
    
    checkConnections();
    
    // Force exit after 15 seconds
    setTimeout(() => {
      logger.warn('Force exiting after timeout.');
      process.exit(1);
    }, 15000);
  });
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  executeCommand('python --version', 5000)
    .catch(error => {
      logger.error(`Initial Python check failed: ${error.message}`);
    });
});

// Process signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', () => gracefulShutdown('UNCAUGHT_EXCEPTION'));
process.on('unhandledRejection', () => gracefulShutdown('UNHANDLED_REJECTION'));