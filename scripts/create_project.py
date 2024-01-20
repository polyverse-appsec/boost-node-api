import argparse
import json
import requests
import jwt
import boto3
import subprocess
import time


REMOTE_URL = "https://3c27qu2ddje63mw2dmuqp6oa7u0ergex.lambda-url.us-west-2.on.aws"  # Dev_url
LOCAL_URL = "http://localhost:3000"
BASE_URL = LOCAL_URL

python_cmd = "python3"  # or "python"


def get_private_key():
    secret_name = "boost-sara/sara-client-private-key"
    region_name = "us-west-2"

    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    get_secret_value_response = client.get_secret_value(
        SecretId=secret_name
    )

    # Decrypts secret using the associated KMS key.
    private_key = get_secret_value_response['SecretString']

    return private_key


def get_headers(email):
    private_key = get_private_key()

    unsigned_identity = {"email": email}
    signed_identity = jwt.encode(unsigned_identity, private_key, algorithm='RS256')
    signed_headers = {'x-signed-identity': signed_identity}

    # unsignedHeaders = {'x-user-account': email}

    return signed_headers


def create_project(email, organization, github_uri, project_name=None):

    # check account status
    response = requests.get(f"{BASE_URL}/api/user/{organization}/account", headers=get_headers(email))
    print(f"Account Status: ${response.json()}")

    data = {"resources": [{"uri": github_uri}]}

    response = requests.post(f"{BASE_URL}/api/user_project/{organization}/{project_name}", json=data, headers=get_headers(email))
    return response


def run_script(summarizer_path, args):
    try:
        print(python_cmd, summarizer_path, args)
        result = subprocess.run([python_cmd, summarizer_path, args], check=True, capture_output=True, text=True)
        print(f"Output of summarizer:\n{result.stdout}")
    except subprocess.CalledProcessError as e:
        print(f"Error running summarizer:\n{e.output}")


def read_file(file_path):
    with open(file_path, 'r') as file:
        return file.read()


def post_data_references(email, organization, project_name):

    post_response = requests.post(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data_references/", headers=get_headers(email))
    if post_response.status_code != 200:
        print(f"Failed to process data references: {post_response.status_code}, {post_response.text}")
        return

    # GET request to retrieve processed data
    get_response = requests.get(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data_references/", headers=get_headers(email))
    if get_response.status_code == 200:
        print(get_response.text)
    else:
        print(f"Failed to retrieve data references: {get_response.status_code}, {get_response.text}")


def helper_task_generator_launch(email, organization, project_name, resource_type):
    print(f"Launching a generator for a {resource_type} resource")

    headers = get_headers(email)

    response = requests.get(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data/{resource_type}/generator", headers=headers)
    response_dict = response.json()

    if response_dict['status'] != "idle":
        print("Generator is not idle, please wait for processing to finish")
        print(f"Generator status: {response_dict}")

        exit(1)

    # start the task generator
    response = requests.post(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data/{resource_type}/generator", json={"status": "processing"}, headers=headers)

    # we'll loop until the generator is idle or in an error state - for 30 seconds max
    #       every second, we'll do a GET and check its state
    #       if it's idle, we'll break out of the loop and pass the test
    #       if it's in an error state, we'll break out of the loop and fail the test
    #       if it's still processing, we'll continue looping
    #       each loop, we'll print the current generator state
    # for i in range(48):
    i = 0
    while True:
        i += 1
        print(f"Checking {resource_type} Resource/Generator #{i}")

        response = requests.get(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data/{resource_type}/generator", headers=headers)
        response_dict = response.json()

        print(f"Check {i}:\n\t{response.json()}")

        # if the generator is idle or an error, we'll exit the loop
        # otherwise, keep 'processing'
        if response_dict["status"] == "idle":
            break
        if response_dict["status"] == "error":
            break

        # make sure the blueprint resource is still available
        response = requests.get(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data/{resource_type}", headers=headers)

        # wait a couple seconds before re-sampling
        time.sleep(5)

    response = requests.get(f"{BASE_URL}/api/user_project/{organization}/{project_name}/data/{resource_type}", headers=headers)
    print("Generated File Data: ", resource_type)


def main():
    parser = argparse.ArgumentParser(description='Create a project with user info.')
    parser.add_argument('--email', type=str, help='Email of the user')
    parser.add_argument('--organization', nargs='?', type=str, help='Organization name')
    parser.add_argument('--github_uri', type=str, help='URI to GitHub repository')
    # parser.add_argument('--path_to_summarizer', type=str, help='Path to summarizer folder')
    parser.add_argument('--project_name', nargs='?', type=str, help='Project name (optional)')
    args = parser.parse_args()

    # Print the user information
    print(f"User Email: {args.email}")
    if not args.organization:
        # if no organization is provided, then we'll pull the organization name from github uri (e.g. polyverse-appsec)
        args.organization = args.github_uri.split('/')[-2]
    if not args.organization:
        print("Organization not available.")
        return
    print(f"Organization: {args.organization}")
    print(f"GitHub URI: {args.github_uri}")
    if not args.project_name:
        # if no project is provided, then we'll pull the repo name from github uri (e.g. summarizer)
        # https://github.com/polyverse-appsec/summarizer
        args.project_name = args.github_uri.split('/')[-1]
    if not args.project_name:
        print("Project name not available.")
        return
    print(f"Project Name: {args.project_name}")

    # Create the project
    response = create_project(args.email, args.organization, args.github_uri, args.project_name)
    print(f"Project creation response: {response.status_code}, {response.text}")

    # Generate files using summarizer
    if response.status_code == 200:
        print("Project created successfully. Running additional scripts...")

        helper_task_generator_launch(args.email, args.organization, args.project_name, "projectsource")
        helper_task_generator_launch(args.email, args.organization, args.project_name, "aispec")
        helper_task_generator_launch(args.email, args.organization, args.project_name, "blueprint")

        # Poke openai to process the files
        post_data_references(args.email, args.organization, args.project_name)
        print("Successfully finished script! Created project, generated files, and posted to openai.")

    else:
        print(f"Failed to create project. Server responded with: {response.status_code}, {response.text}")


if __name__ == "__main__":
    main()
