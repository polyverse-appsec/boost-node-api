Polyverse Boost ReST API (Backend)
======================

# Release Notes

## Version 0.10.0: February 9th, 2024

### New Features
- N/A

### Enhancements
- Enable upload of single resources when other resources are unavailable or fail to upload
- If OpenAI Servers are overloaded and we've exceeded API throttle limit (50 calls/minute), then don't retry OpenAI calls
- Skip OpenAI server upload of resource if the resource is already uploaded (e.g. no need to re-upload)

### Bug Fixes
- N/A

## Version 0.9.13: February 8th, 2024

### New Features
- N/A

### Enhancements
- Report errors in generator status details when a generator fails to complete (e.g. Blueprint, AI Spec, etc)
- Include source file path in the AI spec generation process

### Bug Fixes
- Fix projectsource/aispec source download failure - e.g. over 4mb payload size limit, by not pulling down binary files

## Version 0.9.12: February 8th, 2024

### New Features
- N/A

### Enhancements
- Enable parallel resource generation in discovery to ensure discovery completes in 25 seconds or less
- Change Blueprint generation to skip AI services (for now) by default to stay within 25 second timeout
    - Enable AI generated Blueprints with env variable AI_BLUEPRINT

### Bug Fixes
- N/A

## Version 0.9.11: February 7th, 2024

### New Features
- N/A

### Enhancements
- Cleaned up noisy logging - can be enabled for tracing with Env variable TRACE_LEVEL (any value)
- Enforce per project grooming timeouts (<25 seconds); and report status of groomer in grooming calls, including errors or timeouts
- Generators will no longer reset to blank if discovery is called after a Generator completes - process stage "Initialize" to reset a Generator manually

### Bug Fixes
- Fix issue preventing AI specifications from being saved to resource data

## Version 0.9.10: February 6th, 2024

### New Features
- N/A

### Enhancements
- Split Blueprint Generator stages for File Import and File Scan - to improve responsiveness
- Log full Request Uri for Internal Service Errors; log and return Call stack for known Deployment Servicess
- Added support requesting a project status update - by calling PATCH /api/user_project/{org}/{project}/status with status=Unknown
- Ensure Generator refreshes Project Status after any stage changes, or processing or error changes

### Bug Fixes
- Fix missing generator stage (e.g. breaking Generator scratch data save and loads) - was causing Generators to fail

## Version 0.9.9: February 6th, 2024

### New Features
- N/A

### Enhancements
- Ensure Project Creation completes in ~15 seconds or less (with Discovery forked) /api/user_project/{org}/{project} (POST/PUT)
- If Project POST/PUT is submitting the same as existing project data, then skip GitHub validation and discovery launch
- Update Generator for AI Specification to process each file as a single stage (to stay within 30 second timeout)
- Update AI Proxy Service to support 28 second timeout (<30 Serverless timeout) for all routes at /api/proxy/ai/
- Enable Generator stages to rerun if they fail (e.g. if cached file contents are missing, they can be regenerated)

### Bug Fixes
- Fix issue preventing Blueprint data from refreshing correctly (was not loading draft blueprint data)
- Fix inability to fetch result of PUT/POST for local dispatch calls

## Version 0.9.8: January 31st, 2024

### New Features
- Added new Local Server Timer (defaults to 5 minutes) for groomer - can be configured via /api/timer/config (POST)
- Added timer interval processing service /api/timer/interval (POST) triggers on every timer interval
- Added grooming processor for all projects re-discovery /api/groom/projects (POST)
- Added grooming processor per project re-discovery /api/user_project/{org}/{project}/groom (POST)

### Enhancements
- Return the owner of a project for /api/user_project/{org}/{project} (GET) - to enable user to see who owns the project
- Return 404, 401 or 500 status code if trying to get project status for a non-existent project /api/user_project/{org}/{project}/status (GET)
- Print a scary warning if user tries to use ENABLE_UNSIGNED_AUTHN (e.g. x-user-account) - since most APIs don't support it
- Ensure we normalize all emails / identities including signed headers
- Project Status reports on Resources in Error (not just missing or incomplete) at /api/user_project/{org}/{project}/status (GET)

### Bug Fixes
- Always return Resource Status (with last_updated time) for Resources that exist /api/user_project/{org}/{project}/data/{resource}/status (GET) - was returning no resource if no timestamp was stored
- Fix JSON/String decoding from buffer for Generator POST/PUT/PATCH and process (was failing to parse)
- Report 400 if bad JSON input for body in POST/PATCH/PUT APIs

## Version 0.9.7: January 30th, 2024

### New Features
- Added Project Search Service API /api/search/projects (GET) to search for a project (by wildcard '*') or specific org, user/owner or prpject name

### Enhancements
- Enable refresh of Project Status via /api/user_project/{org}/{project}/status (POST) - and make GET fast to retrieve cached status

### Bug Fixes
- Ensure we return a full JSON object from /api/user_project/{org}/{project}/data/{resource}/generator (GET) - was returning a raw string
- Ensure project creation can work without specifying any GitHub resource URIs (e.g. empty project) - discovery was failing

## Version 0.9.6: January 26th, 2024

### New Features
- N/A

### Enhancements
- Improved details status in /api/user_project/{org}/{project}/status (GET) to include all resources and generators
- Special case detection of GitHub public access rate limiting - logged
- Enable Premium / Paid accounts to bypass Public Repo limits to use authenticated GitHub API calls
- Migrated Backend Service to AWS JavaScript v3 syntax (small bits of code using v2 syntax, most was v3 syntax) - reducing size of Backend Service package
- Enhanced project status tracking to determine if active Resource generation is ongoing, or has stalled (e.g. no progress in 5 minutes)

### Bug Fixes
- Report synchronized flag in /api/user_project/{org}/{project}/status (GET) to indicate if all data is synchronized to AI Servers (was always false, even when synchronized)
- Fix issue with incorrect Dynamo table (for installation data) being used (was not setting the stage suffix on the table name)
- Fix incorrect error handling for user trying to access a private repo without GitHub App Installation

## Version 0.9.5: January 24th, 2024

### New Features
- N/A

### Enhancements
- N/A

### Bug Fixes
- Fixed global JSON and Text Payload limits to be 10mb (JSON) and 1mb (text) to enable download and saving of large source projects (~120 files is 220k)

## Version 0.9.4: January 24th, 2024

### New Features
- Add individual Service API to process a single Resource Generator stage /api/user_project/{org}/{project}/data/{resource}/generator/process (POST)

### Enhancements
- Use the actual OpenAI file created timestamp on the File Ids (instead of HTTP file upload time)
- Enable a single retry of OpenAI file upload in case of network conditions or OpenAI server issues

### Bug Fixes
- Fixes for GitHub and internal dispatch calls retrieving JSON data packaged in HTTP frames

## Version 0.9.3: January 23rd, 2024

### New Features
- Added REST API /api/status (GET) to get current API version and status and stage
- Added REST API /api/user_project/{org}/{project}/data/{resource}/status (GET) to get status of a resource (e.g. last updated time)
- Added REST API /api/user_project/{org}/{project}/status (GET) to status of the current project data - to determine if all data generated and synchronized to AI Servers

### Enhancements
- Disabled unsigned authentication headers (x-user-account) - only signed JWT is supported now
- Abort early if generation of Architectural Spec by AI is failing frequently or a continuous series of failures

### Bug Fixes
- N/A

## Version 0.9.2: January 22nd, 2024

### New Features
- Added helper REST API /api/user_project/{org}/{project}/discovery (POST) to initiate discovery process

### Enhancements
- Ensure we return 500 status code for exceptions thrown in all REST APIs
- Enable auto-discovery on project creation
- Change generator timeout to 1 sec (from 2 secs.) to initiate processing start (to avoid cascading delays)
- Make Blueprint generator resilient to missing either code or project file sample - but not both

### Bug Fixes
- Fix ignore Module import syntax - was incorrect when deployed in AWS
- Fix local dispatch service calls - impacting generators, account lookup and discovery

## Version 0.9.1: January 18th, 2024

### New Features
- N/A

### Enhancements
- N/A

### Bug Fixes
- Fixed missing 'ignore' import causing file filtering generator stages to fail

## Version 0.9.0: January 18th, 2024

### New Features
- Added Project Source Generator (e.g. full source download/combine) via /api/user_project/{org}/{project}/data/projectsource/generator (POST)
- Added Architectural Spec Generator (e.g. AI spec/class analyzer) via /api/user_project/{org}/{project}/data/aispec/generator (POST)

### Enhancements
- Improved Logging for Proxy Requests to AI Service
- Add DEPLOYMENT_STAGE environment variable to specify the deployment stage (e.g. dev, test, prod)
- Add Server HTTP Request logging when DEPLOYMENT_STAGE is set to dev

### Bug Fixes
- Fix case sensitivity in X-Signed-Identity header lookup - causing Auth failures for valid headers
- Fix account API to return JSON instead of raw HTTP response for GET /api/user/{org}/account - also causing project creation errors
- Fix serialization issue with internal HTTP dispatch - impacting account lookups

## Version 0.8.3: January 16th, 2024

### New Features
- Support for Dev, Test, and Prod Stages of Deployment (and Operational Analysis DB)
    - Operational DB is set via environment variable DYNAMO_DB_ANALYSIS (default to Dev)
- Added Project Source Generator (e.g. full source download/combine) via /api/user_project/{org}/{project}/data/projectsource/generator (POST)

### Enhancements
- Service renamed to: boost-rest-api for clarification

### Bug Fixes
- N/A

## Version 0.8.2: January 16th, 2024

### New Features
- Add API /api/user_project/{org}/{project}/data/{resource}/generator (DELETE) to reset a generator

### Enhancements
- Consistent return of 404 if Project not found/created when accessing Project data (e.g. resource, generator, goals, etc)
- Support PUT in addition to existing POST for /api/user_project/{org}/{project}
- Enable /user/{org}/connectors/github/file (GET) to retrieve a file based on repo and path instead of full URI
- Add support for text/plain content type handler for Boost Service (e.g. writing Resource data)

### Bug Fixes
- Enable any resource with github.com as the domain to work (was failing if the resource was www.github.com)
- Many bugfixes for Blueprint generator to complete successfully
- Fixes to Resource Generator Patch and PUT/POST Service APIs to correctly update last_updated timestamp

## Version 0.8.1: January 15th, 2024

### New Features
- New API /api/user/{org}/account to get status of user account (GET)

### Enhancements
- Return Project data for GET /api/user/{org}/project/{project} (POST)
- Return error for empty resource on /api/user/{org}/project/{project}/data/{resource} (POST)
- Validation of Account 'plan' for Project Repo access during Project creation/update (POST/PATCH)
- Enable support for accessing private Repos attached to another Organization

### Bug Fixes
- Return JSON object instead of raw JSON string for GET /api/user/{org}/project/{project}

## Version 0.8.0: January 11th, 2024

### New Features
- Base API for resource generator (e.g. blueprint, aispec, etc) (GET/POST) - Task-based API, doesn't yet generate real data
- Default (Empty) Architectural Blueprint Generator (POST)
- Stub APIs for resource generator aispec and projectsource (POST)
- Add API to GET /{project}/config/.boostignore info (read-only for now), and per project
- New API Proxy Service - enabling Sara to talk to Boost AI service with signed headers (requiring an org-level secret)

### Enhancements
- Enable signed call-outs from Backend Service API or Boost Lambda (when available)
- Ensure all user data is stored in isolated KV rows - previously repo data was stored per repo org (default is isolation for now)

### Bug Fixes
- Fix issue in resource data for Project creation - incorrectly stored when using comoatibility mode
- Ensure goals and data_references are returned as JSON object, not a string
- Fix issue with deserialization of data_references from storage (returning JSON string instead of an object to user)
- Fix filename extension typo for aispec and blueprint files to .ms instead of .md

## Version 0.7.0: January 5th, 2024

### New Features
- Add API /user_resource_folders to retrieve all resource folders for a GitHub project (GET)
- Add API /user_resource_files to retrieve all resource files for a GitHub project (GET)

### Enhancements
- Enable post of project and goals with an HTTP body that is a JSON object (instead of a JSON string)
- Ensure project creation doesn't store arbitrary data (e.g. only store project guidelines and resources)
- Project Resources are now a complex object with primary/reference type and access type (Public or Private) for user
    - NOTE: this is backward compatible for POST, but GET will return the new object type
- Rename API from /get_file_from_uri to /user_resource_file (GET)

### Bug Fixes
- Fix async bug in AWS secret retrieval, ensure secrets aren't logged to server console
- Fix private/public key validation and AWS Secret retrieval for AuthN JWT

## Version 0.6.1: January 4th, 2024

### New Features
- N/A

### Enhancements
- N/A

### Bug Fixes
- Ensure data_references and project data are returmed by GET in object form

## Version 0.6.0: January 4th, 2024

### New Features
- Added APIs /user_project/:org/:project goals, analysis and data_references to delete user project data (DELETE)
- Added API /user_project/:org/:project/data (GET/POST) to create/upload user data (e.g. project data, aispec, blueprint, etc)

### Enhancements
- Renamed API from get_file_from_uri to user_project_file (GET)
- Renamed API from /user_project/ to /user_project/:org/:project
- Renamed API from /user_project_goals/ to /user_project/:org/:project/goals
- Renamed API from /user_project_data_references/ to /user_project/:org/:project/data_references
- Project Data and Project Goals are persisted
- Project Data References can be retrieved by project name
- JWT-based Identity AuthN is now supported for all REST APIs:
    - pass the JWT via the x-signed-identity header
    - specify the public key via environment variable JWT_PUBLIC_KEY or AWS Secret Manager
    - specify the JWT signing algorithm via x-signing-algorithm
- User Account can be passed via x-user-account header (for local testing only - set environment var ENABLE_UNSIGNED_AUTHN )
- Data Resources for a project GET/POST are supported over 300k (e.g. all source code combined)

### Bug Fixes
- Enable access to public source code without installing the GitHub App for Boost Sara
- Return invalid resource type if file is not foumd, but not a single file (e.g. a directory)
- Fix Git file retrieval based on master branch (instead of main)

## Version 0.5.0: December 29th, 2023

### New Features
- Stubs for user_project API (GET, POST) to store and retrieve project data used for AI guidance
- Stubs for user_project_goals API (GET, POST) to store and retrieve goals used for AI guidance

### Enhancements
- renamed get_vectorstore_project_data to user_project_data_references (GET only)

### Bug Fixes
- N/A

## Version 0.4.2: December 22nd, 2023

### New Features
- N/A

### Enhancements
- Added support for encoded and unencoded uri query params when retrieving files from GitHub.com
- for get_file_from_uri, return file contents as plain-text content type, instead of encapsulated JSON

### Bug Fixes
- Restore support for CORS support
- Fix issue with resource data not being loaded via HTTP GET

## Version 0.4.1: December 21st, 2023

### New Features
- N/A

### Enhancements
- user_project_data_references returns file ids for combined raw project data, aispec and blueprint files
- AI file resources are prefixed with project org and name

### Bug Fixes
- N/A

## Version 0.4.0: December 21st, 2023

### New Features
- (Draft) Added service for creating Project Data for Vector Store per GitHub project

### Enhancements
- N/A

### Bug Fixes
- Fixed issue with Analysis Storage access issues when reading / writing data
- Fixed issue with the analysis store reads failing (writes worked)

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
