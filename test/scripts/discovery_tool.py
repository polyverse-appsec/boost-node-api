import sys
sys.path.append("..")
import requests
from utils import get_signed_headers  # Replace with the actual function name
from constants import LOCAL_URL, CLOUD_URL_DEV, CLOUD_URL_PROD, CLOUD_URL_TEST, PREMIUM_EMAIL

URL = LOCAL_URL
# Endpoint details
org = "polyverse-appsec"
project = "nextsara"
status_endpoint = f"{URL}/api/user_project/{org}/{project}/status"
discovery_endpoint = f"{URL}/api/user_project/{org}/{project}/discovery"
data_references_endpoint = f"{URL}/api/user_project/{org}/{project}/data_references"
projectsource_generator_endpoint = f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator"
aispec_generator_endpoint = f"{URL}/api/user_project/{org}/{project}/data/aispec/generator"
blueprint_generator_endpoint = f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator"
blueprint_generator_start = f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator"
email = "airbear109@gmail.com"

# Generate signed header
# Assuming `generate_signed_header` is a function that returns the signed header value
signed_header_value = get_signed_headers(email)

# Making the GET request
#response = requests.post(status_endpoint, headers=signed_header_value)
#response = requests.post(discovery_endpoint, headers=signed_header_value)
#response = requests.get(data_references_endpoint, headers=signed_header_value)
#response = requests.get(projectsource_generator_endpoint, headers=signed_header_value)
#response = requests.get(aispec_generator_endpoint, headers=signed_header_value)
response = requests.get(blueprint_generator_endpoint, headers=signed_header_value)
#response = requests.post(blueprint_generator_start, json={"status": "processing"}, headers=signed_header_value)

# Output the response
print(response.status_code)
print(response.text)
