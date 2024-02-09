import argparse
import requests
import os
import sys
import json

# Determine the parent directory's path.
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Append the parent directory to sys.path.
sys.path.append(parent_dir)

from test.utils import get_signed_headers  # noqa

# Constants for URL options
stage_url = {
    "local": "http://localhost:3000",
    "dev": "https://3c27qu2ddje63mw2dmuqp6oa7u0ergex.lambda-url.us-west-2.on.aws",
    "test": "https://sztg3725fqtcptfts5vrvcozoe0nxcew.lambda-url.us-west-2.on.aws",
    "prod": "https://33pdosoitl22c42c7sf46tabi40qwlae.lambda-url.us-west-2.on.aws"
}


def make_request(method, url, email):
    signed_header_value = get_signed_headers(email)
    if method == "GET":
        response = requests.get(url, headers=signed_header_value)
    elif method == "POST":
        response = requests.post(url, headers=signed_header_value)
    else:
        raise ValueError("Unsupported method")
    return response


def main(email, org, project, method, stage):
    URL = stage_url[stage]
    endpoints = {
        "status": f"{URL}/api/user_project/{org}/{project}/status",
        "data_references": f"{URL}/api/user_project/{org}/{project}/data_references",

        "discovery": f"{URL}/api/user_project/{org}/{project}/discovery",

        "projectsource": f"{URL}/api/user_project/{org}/{project}/data/projectsource",
        "aispec": f"{URL}/api/user_project/{org}/{project}/data/aispec",
        "blueprint": f"{URL}/api/user_project/{org}/{project}/data/blueprint",

        "projectsource_gen": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator",
        "aispec_gen": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator",
        "blueprint_gen": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator",

        "create_blueprint": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator/start",
        "create_aispec": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator/start",
        "create_projectsource": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator/start"
    }

    if method not in endpoints:
        print(f"Method {method} is not supported.")
        return

    url = endpoints[method]
    # if method starts with "create_" or is "discovery", then it's a POST request
    response = make_request("POST" if method.startswith("create_") or method == "discovery" else "GET", url, email)

    # Output the response
    print(response.status_code)

    if (response.status_code != 200):
        print(f"Failed({response.status_code}): {response.text}")
    else:
        if response.headers.get('content-type') == 'application/json':
            print(response.json() if 'body' not in response.json() else json.loads(response.json()['body']))
        else:
            print(response.text if 'body' not in response.json() else response.json()['body'])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CLI utility for managing user projects.")
    parser.add_argument("--email", required=True, help="The user's email address")
    parser.add_argument("--org", default="polyverse-appsec", help="The organization name (default: polyverse-appsec)")
    parser.add_argument("--project", required=True, help="The project name")
    parser.add_argument("--method", default="status", choices=['status', 'discovery', 'data_references', 'projectsource', 'aispec', 'blueprint', 'blueprint_gen', 'projectsource_gen', 'aispec_gen'], help="The method to run")
    parser.add_argument("--stage", default="local", choices=['local', 'dev', 'test', 'prod'], help="The Service to target (default: local)")

    args = parser.parse_args()
    main(args.email, args.org, args.project, args.method, args.stage)
