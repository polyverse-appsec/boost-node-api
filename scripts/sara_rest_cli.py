import argparse
import requests
import os
import sys
import json
import datetime
import time

# Determine the parent directory's path.
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Append the parent directory to sys.path.
sys.path.append(parent_dir)

try:
    from test.utils import get_signed_headers
except ImportError:
    sys.path.append(parent_dir + "/test")

    from utils import get_signed_headers  # type: ignore


# Constants for URL options
stage_url = {
    "local": "http://localhost:3000",
    "dev": "https://3c27qu2ddje63mw2dmuqp6oa7u0ergex.lambda-url.us-west-2.on.aws",
    "test": "https://sztg3725fqtcptfts5vrvcozoe0nxcew.lambda-url.us-west-2.on.aws",
    "prod": "https://33pdosoitl22c42c7sf46tabi40qwlae.lambda-url.us-west-2.on.aws"
}


def make_request(method, url, email, data):
    signed_header_value = get_signed_headers(email) if email is not None else None
    if method == "GET":
        response = requests.get(url, headers=signed_header_value)
    elif method == "POST":
        response = requests.post(url, headers=signed_header_value, data=data)
    elif method == "DELETE":
        response = requests.delete(url, headers=signed_header_value)
    else:
        raise ValueError("Unsupported method")
    return response


def main(email, org, project, method, stage, data):

    if method in ["create_auth_token"]:
        expires = True if data is True else False
        auth_token = get_signed_headers(email, expires, True)
        print(f"Auth Token:\n{json.dumps(auth_token, indent=4)}")

        exit(0)

    URL = stage_url[stage]
    endpoints = {
        "test": f"{URL}/test",

        "status": f"{URL}/api/user_project/{org}/{project}/status",
        "status_refresh": f"{URL}/api/user_project/{org}/{project}/status",
        "status_assistant": f"{URL}/api/user_project/{org}/{project}/status?verifyAssistant",

        "account": f"{URL}/api/user/{org}/account",
        "org_account": f"{URL}/api/org/{org}/account",

        "data_references": f"{URL}/api/user_project/{org}/{project}/data_references",
        "data_references_refresh": f"{URL}/api/user_project/{org}/{project}/data_references",

        "projects": f"{URL}/api/user_project/{org}/projects",
        "projects_all": f"{URL}/api/search/projects",

        "project": f"{URL}/api/user_project/{org}/{project}",
        "project_create": f"{URL}/api/user_project/{org}/{project}",
        "project_delete": f"{URL}/api/user_project/{org}/{project}",

        "groom_status": f"{URL}/api/user_project/{org}/{project}/groom",
        "groom_toggle": f"{URL}/api/user_project/{org}/{project}/groom",

        "discover": f"{URL}/api/user_project/{org}/{project}/discover",
        "rediscover": f"{URL}/api/user_project/{org}/{project}/discover",

        "resource": f"{URL}/api/user_project/{org}/{project}/data/{data}",

        "gen_resource": f"{URL}/api/user_project/{org}/{project}/data/{data}/generator",

        "gen_status": f"{URL}/api/user_project/{org}/{project}/data/{data}/generator",

        "resource_status": f"{URL}/api/user_project/{org}/{project}/data/{data}/status",

        "search_generators_all": f"{URL}/api/search/projects/generators",
        "search_generators": f"{URL}/api/search/projects/generators?resource={data}",

        "gen_resource_process": f"{URL}/api/user_project/{org}/{project}/data/{data}/generator/process",

        "aifiles": f"{URL}/api/user/{org}/connectors/openai/files",
        "aifiles_purge": f"{URL}/api/user/{org}/connectors/openai/files?groom&afterDate={data}",
        "aifiles_purge_at": f"{URL}/api/user/{org}/connectors/openai/files?groom&startAtFile={data}",
        "aifile_delete": f"{URL}/api/user/{org}/connectors/openai/files/{data}",

        "assistants": f"{URL}/api/user/{org}/connectors/openai/assistants",
        "delete_assistants": f"{URL}/api/user/{org}/connectors/openai/assistants?noFiles" + ("&confirm" if data == "confirm" else ""),

        "github_access": f"{URL}/api/user/{org}/connectors/github/access?uri={data}",

        "timer_interval": f"{URL}/api/timer/interval",
        "groom_discoveries_list": f"{URL}/api/search/projects/groom?status=Pending",
        "groom_discoveries": f"{URL}/api/groom/projects",
    }

    if method not in endpoints:
        print(f"Method {method} is not supported.")
        return

    test_url = endpoints["test"]
    retry = 0
    while True:
        try:
            response = make_request("GET", test_url, None, None)
            if response.status_code == 200:
                break
        # control-c
        except KeyboardInterrupt:
            print("Aborting...")
            return
        # look for RemoteDisconnected to retry
        # or NewConnectionError to retry
        except requests.exceptions.ConnectionError as e:
            if "NewConnectionError" in str(e) or "RemoteDisconnected" in str(e):
                if retry == 0:
                    print("Remote Server not responding... Retrying...")
                retry += 1
                # print a single dot (without a newline) for every retry
                print(".", end="", flush=True)
                try:
                    time.sleep(1)
                except KeyboardInterrupt:
                    print("Aborting...")
                    return
                continue
            else:
                print(f"Failed: {e}")
                return
        except requests.exceptions.RequestException as e:
            print(f"Failed: {e}")
            return
    if retry > 0:
        print("")

    url = endpoints[method]
    # if method starts with "create_" or is "discover", then it's a POST request
    verb = "POST" if (
        "create" in method or  # noqa: W504
        method.endswith("_gen") or  # noqa: W504
        method in [
            "discover",
            "rediscover",
            "data_references_refresh",
            "status_refresh",
            "status_assistant",
            "timer_interval",
            "groom_discoveries",
            "groom_toggle"
        ]
    ) else "DELETE" if (
        "delete" in method or  # noqa: W504
        "purge" in method
    ) else "GET"
    data = data if method not in ["rediscover"] else json.dumps({"resetResources": True})
    data = data if method not in ["groom_toggle"] else json.dumps({"status": "Disabled"}) if data is None else json.dumps({"status": "Idle"})
    data = data if method not in ["project_create"] else json.dumps({"resources": [{"uri": data}]})

    if data is None:
        print(f"Requesting {verb} {url}")
    else:
        print(f"Requesting {verb} {url} with data: {data}")

    try:
        response = make_request(verb, url, email, data)
    except requests.exceptions.RequestException as e:
        print(f"Failed: {e}")
        return

    if (response.status_code != 200):
        if response.status_code == 202:
            print(f"Warning ({response.status_code}):\n\t{response.text}")
        else:
            print(f"Failed ({response.status_code}):\n\t{response.text}")
    else:
        print(f"Success({response.status_code})\n")

        if len(response.text) == 0:
            return

        def print_response(responseObj):
            def print_json(json_obj):
                if 'lastUpdated' in json_obj:
                    # pretty print a unixtime as a human-readable date - lastUpdated can be a string or a number
                    pretty_last_updated = datetime.datetime.fromtimestamp(json_obj['lastUpdated'] if isinstance(
                        json_obj['lastUpdated'], float) else float(json_obj['lastUpdated']))
                    print(f"lastUpdated: {pretty_last_updated}")
                    if isinstance(json_obj['lastUpdated'], str):
                        print("Invalid lastUpdated format")
                print(json_obj)
                print()

            # if the response is a list, print each item on a new line
            if isinstance(responseObj, list):
                for item in responseObj:
                    print_json(item)

                print(str(len(responseObj)) + " items")
            elif responseObj is None or len(responseObj) == 0:
                print("No data")
            else:
                print_json(responseObj)

        if response.headers.get('content-type').startswith('application/json'):
            responseObj = response.json() if 'body' not in response.json() else json.loads(response.json()['body']) if (len(response.json()['body']) > 0 and response.json()['body'][0] in ['{', '[']) else response.json()['body']

            print_response(responseObj)
        else:
            # check if response.text starts with a JSON character
            if response.text[0] in ['{', '[']:
                print(response.text if 'body' not in response.json() else response.json()['body'])
            else:
                print(response.text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CLI utility for managing user projects.")
    parser.add_argument("--email", required=False, help="The user's email address")
    parser.add_argument("--org", required=False, help="The organization name (default: polyverse-appsec)")
    parser.add_argument("--project", required=False, help="The project name")
    parser.add_argument("--method", default="status",
                        choices=['status',
                                 'status_refresh',
                                 'status_assistant',

                                 'create_auth_token',

                                 'account',
                                 'org_account',

                                 'projects',
                                 'project',
                                 'projects_all',
                                 'project_delete',
                                 'project_create',

                                 'groom_status',
                                 'groom_disable',

                                 'search_generators_all',
                                 'search_generators',

                                 'discover',
                                 'rediscover',
                                 'data_references',
                                 "data_references_refresh",

                                 'resource',

                                 'gen_resource',

                                 'gen_status',

                                 'resource_status',

                                 'aifiles',
                                 'aifiles_purge',
                                 'aifiles_purge_at',
                                 'aifile_delete',

                                 'assistants',
                                 'delete_assistants',

                                 'github_access',

                                 'timer_interval',
                                 'groom_discoveries_list',
                                 'groom_discoveries'
                                 ], help="The method to run")
    parser.add_argument("--stage", default="local", choices=['local', 'dev', 'test', 'prod'], help="The Service to target (default: local)")
    parser.add_argument("--data", default=None, help="Data to pass to the method")

    args = parser.parse_args()

    if (args.project is None and args.method not in [
        "account",
        "create_auth_token",
        "org_account",
        "data_references",
        "aifiles",
        "aifiles_purge",
        "aifiles_purge_at",
        "aifile_delete",
        "assistants",
        "github_access",
        "projects",
        "projects_all",
        "search_generators_all",
        "search_generators",
        "timer_interval",
        "groom_discoveries_list",
        "groom_discoveries",
        "delete_assistants"
    ]):
        parser.error("The --project argument is required for the method"
                     f" {args.method}.")
    if (args.email is None and args.method not in [
            "projects_all"]):
        parser.error("The --email argument is required for the method"
                     f" {args.method}.")
    if args.org is None:
        if args.method not in [
            "aifiles_purge",
            "aifiles_purge_at",
            "aifile_delete",
            "delete_assistants",
            "assistants"
        ]:
            args.org = "polyverse-appsec"
        else:
            args.org = "localhost"  # default org to make connector calls, even though it will be ignored

    main(args.email, args.org, args.project, args.method, args.stage, args.data)
