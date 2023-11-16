Polyverse Boost GitHub App
======================

# Release Notes

## Version 0.1.1: November 16th, 2023

### New Features
- N/A

### Enhancements
- Raise Node to v18 to fix Octokit/rest load issues
- Print App Version on startup

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
