# Python Code Executor Server

A secure Node.js server for executing Python code and hosting files with automatic cleanup.

## Features

- **Code Execution**: Execute Python code securely with configurable timeouts and network access controls
- **File Hosting**: Upload and temporarily host files with automatic cleanup
- **Health Monitoring**: Check server status and Python environment
- **API Information**: Get detailed API metadata and endpoints

## Code Execution API

### Execute Python Code

**Endpoint:** `POST /execute`

Execute Python code and return the output. The server creates a temporary execution environment, runs the code, and cleans up afterward. Generated files can be downloaded via tokens.

#### Request

- **Method:** POST
- **Content-Type:** application/json
- **Body Parameters:**
  - `code` (string, required): Python code to execute
  - `timeout` (number, optional): Execution timeout in seconds (default: 30, max: 60)
  - `allow_network` (boolean, optional): Allow network access during execution (default: false)

#### Example Request (cURL)

```bash
curl -X POST http://localhost:8000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "print(\"Hello, World!\")",
    "timeout": 10,
    "allow_network": false
  }'
```

#### Example Request (JavaScript/fetch)

```javascript
fetch('http://localhost:8000/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    code: 'print("Hello, World!")',
    timeout: 10,
    allow_network: false
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

#### Response

**Success (200):**
```json
{
  "output": "Hello, World!\n",
  "success": true,
  "generatedFiles": [],
  "executionTime": "2025-11-15T15:56:47.385Z"
}
```

**Success with Generated Files:**
```json
{
  "output": "Code executed successfully (no output)",
  "success": true,
  "generatedFiles": [
    {
      "filename": "output.txt",
      "downloadUrl": "/download/abc123-def456-ghi789",
      "expires": "2025-11-15T16:06:47.385Z",
      "mimeType": "text/plain",
      "size": 1024
    }
  ],
  "executionTime": "2025-11-15T15:56:47.385Z"
}
```

**Error (400/500):**
```json
{
  "error": "Error executing Python code",
  "details": "SyntaxError: invalid syntax",
  "success": false,
  "timestamp": "2025-11-15T15:56:47.385Z"
}
```

#### Response Fields

- `output` (string): Standard output from the Python execution
- `success` (boolean): Whether the execution was successful
- `generatedFiles` (array): List of files generated during execution (if any)
- `executionTime` (string): ISO 8601 timestamp of execution completion
- `error` (string): Error message (on failure)
- `details` (string): Detailed error information (on failure)

## Health Check API

### Get Server Health

**Endpoint:** `GET /health`

Returns comprehensive server health information including Python version, uptime, and resource usage.

#### Example Request

```bash
curl http://localhost:8000/health
```

#### Response

**Success (200):**
```json
{
  "status": "healthy",
  "pythonVersion": "Python 3.9.7",
  "nodeVersion": "v16.13.0",
  "platform": "linux",
  "architecture": "x64",
  "tempDir": "/app/temp",
  "storageUsage": 0,
  "uptime": 3600,
  "activeDownloads": 0,
  "timestamp": "2025-11-15T15:56:47.385Z"
}
```

**Error (500):**
```json
{
  "status": "unhealthy",
  "error": "Python not available",
  "details": "python: command not found",
  "timestamp": "2025-11-15T15:56:47.385Z"
}
```

#### Response Fields

- `status` (string): Server health status ("healthy" or "unhealthy")
- `pythonVersion` (string): Python version installed
- `nodeVersion` (string): Node.js version
- `platform` (string): Operating system platform
- `architecture` (string): System architecture
- `tempDir` (string): Path to temporary directory
- `storageUsage` (number): Current storage usage in bytes
- `uptime` (number): Server uptime in seconds
- `activeDownloads` (number): Number of active download tokens
- `timestamp` (string): ISO 8601 timestamp

## File Hosting API

### Upload File for Hosting

**Endpoint:** `POST /host`

Upload a file to be hosted temporarily. The file will be available for download via a generated token URL and will auto-delete after 10 minutes.

#### Request

- **Method:** POST
- **Content-Type:** multipart/form-data
- **Body Parameters:**
  - `file` (required): The file to upload (max 20MB)

#### Example Request (cURL)

```bash
curl -X POST http://localhost:8000/host \
  -F "file=@/path/to/your/file.txt"
```

#### Example Request (JavaScript/fetch)

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('http://localhost:8000/host', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

#### Response

**Success (200):**
```json
{
  "downloadUrl": "/download/abc123-def456-ghi789",
  "expires": "2025-11-15T13:23:47.426Z",
  "filename": "file.txt",
  "size": 1024
}
```

**Error (400/500):**
```json
{
  "error": "No file uploaded"
}
```

#### Response Fields

- `downloadUrl` (string): The relative path to download the file (append to base URL)
- `expires` (string): ISO 8601 timestamp when the file will be deleted
- `filename` (string): Original filename
- `size` (number): File size in bytes

### Download Hosted File

**Endpoint:** `GET /download/:token`

Download a hosted or generated file using the token from upload or execution.

#### Example Request

```bash
curl http://localhost:8000/download/abc123-def456-ghi789
```

Files expire after 10 minutes and are automatically cleaned up.

## API Information

### Get API Metadata

**Endpoint:** `GET /api`

Returns detailed API information including version, status, and available endpoints.

#### Example Request

```bash
curl http://localhost:8000/api
```

#### Response

```json
{
  "name": "Python Code Executor API",
  "version": "2.1.0",
  "status": "running",
  "endpoints": {
    "GET /": "API information",
    "GET /health": "Server and Python health check",
    "POST /execute": "Execute Python code",
    "POST /host": "Upload file for hosting",
    "GET /download/:token": "Download hosted or generated file",
    "GET /api": "This endpoint"
  },
  "uptime": 3600,
  "timestamp": "2025-11-15T15:56:47.385Z"
}
```

### Root Endpoint

**Endpoint:** `GET /`

Returns basic server information and available endpoints.

#### Example Request

```bash
curl http://localhost:8000/
```

#### Response

```json
{
  "message": "Python Code Executor Server is running!",
  "status": "healthy",
  "endpoints": {
    "GET /health": "Server health check",
    "POST /execute": "Execute Python code",
    "POST /host": "Upload file for hosting",
    "GET /download/:token": "Download hosted or generated file",
    "GET /api": "API information"
  }
}
```

## Environment Variables

- `PORT`: Server port (default: 8000)
- `NODE_ENV`: Environment mode (default: 'development')
- `ALLOWED_CONNECT_SRC`: Comma-separated list of allowed connect sources for CSP (default: none)

## Notes

- **Rate Limiting:** 50 requests per 15 minutes per IP address
- **CORS:** Enabled for cross-origin requests
- **Security:** Network access is disabled by default for code execution
- **Timeouts:** Code execution has a maximum timeout of 60 seconds
- **File Limits:** Maximum upload size is 20MB
- **Cleanup:** Temporary files and directories are automatically cleaned up after 10 minutes
- **Logging:** All requests are logged with unique request IDs for debugging