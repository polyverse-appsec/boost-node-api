import argparse
import requests
import os
import sys

# Determine the parent directory's path.
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Append the parent directory to sys.path.
sys.path.append(parent_dir)

from test.utils import get_signed_headers  # noqa

# Constants for URL options
LOCAL_URL = "http://localhost:3000"  # Placeholder, replace with your actual local URL

CLOUD_URL_DEV = "https://3c27qu2ddje63mw2dmuqp6oa7u0ergex.lambda-url.us-west-2.on.aws"
CLOUD_URL_TEST = "https://sztg3725fqtcptfts5vrvcozoe0nxcew.lambda-url.us-west-2.on.aws"
CLOUD_URL_PROD = "https://33pdosoitl22c42c7sf46tabi40qwlae.lambda-url.us-west-2.on.aws"


def make_request(method, url, email):
    signed_header_value = get_signed_headers(email)
    if method == "GET":
        response = requests.get(url, headers=signed_header_value)
    elif method == "POST":
        response = requests.post(url, headers=signed_header_value)
    else:
        raise ValueError("Unsupported method")
    return response


def main(email, org, project, method):
    URL = LOCAL_URL  # Decide how you want to set this, maybe another CLI argument
    endpoints = {
        "status": f"{URL}/api/user_project/{org}/{project}/status",
        "discovery": f"{URL}/api/user_project/{org}/{project}/discovery",
        "data_references": f"{URL}/api/user_project/{org}/{project}/data_references",
        "projectsource_generator": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator",
        "aispec_generator": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator",
        "blueprint_generator": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator",
        "blueprint_generator_start": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator/start"
    }

    if method not in endpoints:
        print(f"Method {method} is not supported.")
        return

    url = endpoints[method]
    response = make_request("GET" if method in ["data_references", "projectsource_generator", "aispec_generator", "blueprint_generator"] else "POST", url, email)

    # Output the response
    print(response.status_code)
    print(response.text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CLI utility for managing user projects.")
    parser.add_argument("--email", required=True, help="The user's email address")
    parser.add_argument("--org", default="polyverse-appsec", help="The organization name (default: polyverse-appsec)")
    parser.add_argument("--project", required=True, help="The project name")
    parser.add_argument("--method", required=True, choices=['status', 'discovery', 'data_references', 'projectsource', 'aispec', 'blueprint'], help="The method to run")
    parser.add_argument("--stage", default="local", choices=['local', 'dev', 'test', 'prod'], help="The Service to target (default: local)")

    args = parser.parse_args()
    main(args.email, args.org, args.project, args.method)
