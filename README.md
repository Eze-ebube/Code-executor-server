# Python Code Executor Server

A secure Node.js server for executing Python code and hosting files with automatic cleanup.

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
curl -X POST https://code-executor-server.onrender.com/host \
  -F "file=@/path/to/your/file.txt"
```

#### Example Request (JavaScript/fetch)

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('https://code-executor-server.onrender.com/host', {
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

#### Download File

Use the `downloadUrl` to download the file:

```
GET https://code-executor-server.onrender.com/download/abc123-def456-ghi789
```

Files expire after 10 minutes and are automatically cleaned up.

#### Notes

- Maximum file size: 20MB
- Files are stored temporarily and deleted after 10 minutes
- CORS is enabled for cross-origin requests
- Rate limiting: 50 requests per 15 minutes per IP