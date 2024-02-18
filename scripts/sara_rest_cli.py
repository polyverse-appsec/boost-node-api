import argparse
import requests
import os
import sys
import json

# Determine the parent directory's path.
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Append the parent directory to sys.path.
sys.path.append(parent_dir)

try:
    from test.utils import get_signed_headers
except ImportError:
    sys.path.append(parent_dir + "/test")
    from utils import get_signed_headers  # noqa


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
    elif method == "DELETE":
        response = requests.delete(url, headers=signed_header_value)
    else:
        raise ValueError("Unsupported method")
    return response


def main(email, org, project, method, stage, data):
    URL = stage_url[stage]
    endpoints = {
        "status": f"{URL}/api/user_project/{org}/{project}/status",
        'status_refresh': f"{URL}/api/user_project/{org}/{project}/status",

        'account': f"{URL}/api/user/{org}/account",

        "data_references": f"{URL}/api/user_project/{org}/{project}/data_references",
        "data_references_refresh": f"{URL}/api/user_project/{org}/{project}/data_references",

        "projects": f"{URL}/api/user_project/{org}/projects",

        "project": f"{URL}/api/user_project/{org}/{project}",

        "discovery": f"{URL}/api/user_project/{org}/{project}/discover",

        "projectsource": f"{URL}/api/user_project/{org}/{project}/data/projectsource",
        "aispec": f"{URL}/api/user_project/{org}/{project}/data/aispec",
        "blueprint": f"{URL}/api/user_project/{org}/{project}/data/blueprint",

        "projectsource_gen": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator",
        "aispec_gen": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator",
        "blueprint_gen": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator",

        "projectsource_gen_status": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator",
        "aispec_gen_status": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator",
        "blueprint_gen_status": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator",

        "projectsource_status": f"{URL}/api/user_project/{org}/{project}/data/projectsource/status",
        "aispec_status": f"{URL}/api/user_project/{org}/{project}/data/aispec/status",
        "blueprint_status": f"{URL}/api/user_project/{org}/{project}/data/blueprint/status",

        "create_blueprint": f"{URL}/api/user_project/{org}/{project}/data/blueprint/generator/start",
        "create_aispec": f"{URL}/api/user_project/{org}/{project}/data/aispec/generator/start",
        "create_projectsource": f"{URL}/api/user_project/{org}/{project}/data/projectsource/generator/start",

        "aifiles": f"{URL}/api/user/{org}/connectors/openai/files",
        "aifiles_groom": f"{URL}/api/user/{org}/connectors/openai/files?groom&afterDate={data}",
        "aifile_delete": f"{URL}/api/user/{org}/connectors/openai/files/{data}",

        "assistants": f"{URL}/api/user/{org}/connectors/openai/assistants",

        "github_access": f"{URL}/api/user/{org}/connectors/github/access?uri={data}",
    }

    if method not in endpoints:
        print(f"Method {method} is not supported.")
        return

    url = endpoints[method]
    # if method starts with "create_" or is "discovery", then it's a POST request
    verb = "POST" if method.startswith("create_") or method.endswith("_gen") or method == "discovery" or method == "data_references_refresh" or method == "status_refresh" else "DELETE" if (method == "aifiles_groom" or method == "aifile_delete") else "GET"
    print(f"Requesting {verb} {url}")
    try:
        response = make_request(verb, url, email)
    except requests.exceptions.RequestException as e:
        print(f"Failed: {e}")
        return

    if (response.status_code != 200):
        print(f"Failed({response.status_code}): {response.text}")
    else:
        print(f"Success({response.status_code})\n")

        if len(response.text) == 0:
            return

        if response.headers.get('content-type') == 'application/json':
            print(response.json() if 'body' not in response.json() else json.loads(response.json()['body']))
        else:
            # check if response.text starts with a JSON character
            if response.text[0] in ['{', '[']:
                print(response.text if 'body' not in response.json() else response.json()['body'])
            else:
                print(response.text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CLI utility for managing user projects.")
    parser.add_argument("--email", required=True, help="The user's email address")
    parser.add_argument("--org", default="polyverse-appsec", help="The organization name (default: polyverse-appsec)")
    parser.add_argument("--project", required=False, help="The project name")
    parser.add_argument("--method", default="status",
                        choices=['status',
                                 'status_refresh',

                                 'projects',
                                 'project',

                                 'account',

                                 'discovery',
                                 'data_references',
                                 "data_references_refresh",

                                 'projectsource',
                                 'aispec',
                                 'blueprint',

                                 'blueprint_gen',
                                 'projectsource_gen',
                                 'aispec_gen',

                                 'blueprint_gen_status',
                                 'projectsource_gen_status',
                                 'aispec_gen_status',

                                 'blueprint_status',
                                 'projectsource_status',
                                 'aispec_status',

                                 'aifiles',
                                 'aifiles_groom',
                                 'aifile_delete',

                                 'assistants',

                                 'github_access'
                                 ], help="The method to run")
    parser.add_argument("--stage", default="local", choices=['local', 'dev', 'test', 'prod'], help="The Service to target (default: local)")
    parser.add_argument("--data", default=None, help="Data to pass to the method")

    args = parser.parse_args()

    if (args.project is None and args.method not in [
        "account",
        "status",
        "data_references",
        "aifiles",
        "aifiles_groom",
        "aifile_delete",
        "assistants",
        "github_access",
        "projects"
    ]):
        parser.error("The --project argument is required for the method"
                     f" {args.method}.")

    main(args.email, args.org, args.project, args.method, args.stage, args.data)
