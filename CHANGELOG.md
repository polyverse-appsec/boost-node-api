Polyverse Boost API on Node.js
======================

# Release Notes

## Version 0.3.1: December 20th, 2023

### New Features
- N/A

### Enhancements
- N/A

### Bug Fixes
- Fix service start/load failure (index, aws, etc module references failed)
- Move 'hello world' test endpoint to /test (instead of / root to avoid surpise responses)
- Fix Authorization checks to restrict to polyverse.com domains

## Version 0.3.0: December 20th, 2023

### New Features
- N/A

### Enhancements
- Service code converted from JavaScript to TypeScript
- Change default service timeout to 15 minutes (max) instead of 30 seconds (default) - not needed for now, but for future processing

### Bug Fixes
- Fix version in service header responses and package code

## Version 0.2.0: December 4th, 2023

### New Features
- Added User library
- Added Storage library
        Results are loaded and stored via `GET /api/files/{source}/{owner}/{project}/{path-base64}/{analysis_type}` and `POST /api/files/{owner}/{project}}/{path-base64}/{analysis_type}`

### Enhancements
- Only polyverse.com and polytest.ai accounts are allowed to use the API
- Get file API now returns the X-Resource-Access header if the file is public or private

### Bug Fixes
- N/A

## Version 0.1.2: November 20th, 2023

### New Features
- N/A

### Enhancements
- Ensure logging in all paths for get_file_for_uri

### Bug Fixes
- N/A

## Version 0.1.1: November 16th, 2023

### New Features
- N/A

### Enhancements
- Raise Node to v18 to fix Octokit/rest load issues
- Print App Version on startup
- Enable Polytest.ai accounts to be mapped back to Polyverse.com
- Ensure all accounts are stored as lower-case email for consistency

### Bug Fixes
- N/A

## Version 0.1.0: November 15th, 2023

### New Features
- Added get_file_from_uri API to retrieve files from GitHub
- Use stored Account info (retrieved via GitHub App authorization by user)
- Without user email (already stored in system via GitHub App authorization) - all calls will fail with Unauthorized

### Enhancements
- Enable Secret API to store full text blobs with embedded newlines (e.g. private keys)

### Bug Fixes
- N/A
