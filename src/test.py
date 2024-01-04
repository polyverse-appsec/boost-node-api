import subprocess

# Replace the following variables with your actual values
BASE_URL = "http://localhost:3000"  # Update with your server's URL
EMAIL = "aaron@polyverse.com"  # Replace with the actual email

# Function to create a curl command with the x-user-account header
def create_curl_command(method, url, data=None):
    command = ["curl", "-X", method, "-H", "x-user-account: {EMAIL}", url]
    if data:
        command.extend(["-H", "Content-Type: application/json", "-d", data])
    return command

#  GET request to /api/user_project_file
print("Running test: Retrieve a file from the user's project")
subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project_file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py"))

# GET request to invalid uri
#subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project_file?uri=example.com"))

# Get request to github repo instead of file
#subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project_file?uri=https://github.com/public-apis/"))

#  POST request to /api/user_project/:org/:project
print("Running test: Store data in the user's project")
subprocess.run(create_curl_command("POST", f"{BASE_URL}/api/user_project/org123/project456", '{"org": "myorg", "project": "myproject"}'))

#  GET request to /api/user_project/:org/:project
print("Running test: Retrieve data from the user's project")
subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project/org123/project456"))

#  DELETE request to /api/user_project/:org/:project
print("Running test: Delete data from the user's project")
subprocess.run(create_curl_command("DELETE", f"{BASE_URL}/api/user_project/org123/project456"))

#  POST request to /api/user_project/:org/:project/goals
print("Running test: Store goals data in the user's project")
subprocess.run(create_curl_command("POST", f"{BASE_URL}/api/user_project/org123/project456/goals", "{\"goal\": \" goal value\"}"))

#  GET request to /api/user_project/:org/:project/goals
print("Running test: Retrieve goals data from the user's project")
subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project/org123/project456/goals"))

#  DELETE request to /api/user_project/:org/:project/goals
print("Running test: Delete goals data from the user's project")
subprocess.run(create_curl_command("DELETE", f"{BASE_URL}/api/user_project/org123/project456/goals"))

#  POST request to /api/user_project/:org/:project/data_references
#print("Running test: Storing data references from the user's project")
#subprocess.run(create_curl_command("POST", f"{BASE_URL}/api/user_project/org123/project456/data_references", "{\"reference1\":\"value1\", \"reference2\":\"value2\"}"))

#  GET request to /api/user_project/:org/:project/data_references
#print("Running test: Retrieve data references from the user's project")
#subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/user_project/org123/project456/data_references"))

#  DELETE request to /api/user_project/:org/:project/data_references
print("Running test: Delete data references from the user's project")
subprocess.run(create_curl_command("DELETE", f"{BASE_URL}/api/user_project/org123/project456/data_references"))

#  POST request to /api/files/:source/:owner/:project/:pathBase64/:analysisType
print("Running test: Store files data based on source, owner, project, path, and analysis type")
subprocess.run(create_curl_command("POST", f"{BASE_URL}/api/files/github/org123/project456/cGF0aDExMTExMQ==/analysisType123", "{\"data\": \" data value\"}"))

#  GET request to /api/files/:source/:owner/:project/:pathBase64/:analysisType
print("Running test: Retrieve files data based on source, owner, project, path, and analysis type")
subprocess.run(create_curl_command("GET", f"{BASE_URL}/api/files/github/org123/project456/cGF0aDExMTExMQ==/analysisType123"))

#  DELETE request to /api/files/:source/:owner/:project/:pathBase64/:analysisType
print("Running test: Delete files data based on source, owner, project, path, and analysis type")
subprocess.run(create_curl_command("DELETE", f"{BASE_URL}/api/files/github/org123/project456/cGF0aDExMTExMQ==/analysisType123"))

#  GET request to /test
print("Running test: Demonstrate a simple event stream response")
subprocess.run(create_curl_command("GET", f"{BASE_URL}/test"))
