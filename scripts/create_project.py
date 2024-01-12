import argparse
import requests
import jwt
import boto3
import subprocess


REMOTE_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"
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

    data = {"resources": [{"uri": github_uri}]}

    response = requests.post(f"{REMOTE_URL}/api/user_project/{organization}/{project_name}", json=data, headers=get_headers(email))
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


def post_data(email, organization, project_name, resource_name, data):

    payload = {"resources": data}
    response = requests.post(f"{REMOTE_URL}/api/user_project/{organization}/{project_name}/data/{resource_name}",
                             data=payload, headers=get_headers(email))
    return response


def post_data_references(email, organization, project_name):

    post_response = requests.post(f"{REMOTE_URL}/api/user_project/{organization}/{project_name}/data_references/", headers=get_headers(email))
    if post_response.status_code != 200:
        print(f"Failed to process data references: {post_response.status_code}, {post_response.text}")
        return

    # GET request to retrieve processed data
    get_response = requests.get(f"{REMOTE_URL}/api/user_project/{organization}/{project_name}/data_references/", headers=get_headers(email))
    if get_response.status_code == 200:
        print(get_response.text)
    else:
        print(f"Failed to retrieve data references: {get_response.status_code}, {get_response.text}")


def main():
    parser = argparse.ArgumentParser(description='Create a project with user info.')
    parser.add_argument('--email', type=str, help='Email of the user')
    parser.add_argument('--organization', nargs='?', type=str, help='Organization name')
    parser.add_argument('--github_uri', type=str, help='URI to GitHub repository')
    parser.add_argument('--path_to_summarizer', type=str, help='Path to summarizer folder')
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

        # run_script(args.path_to_summarizer, "--rawonly")
        subprocess.run([python_cmd, args.path_to_summarizer, "--rawonly"], check=True, capture_output=True, text=True)
        print("Raw files generated successfully.")

        # run_script(args.path_to_summarizer, "")
        subprocess.run([python_cmd, args.path_to_summarizer], check=True, capture_output=True, text=True)
        print("Processed summary files generated successfully.")

        # Post files to openai
        for output_file, resource_name in [
            ("allfiles_combined.md", "projectsource"),
            ("aispec.md", "aispec"),
        ]:
            file_content = read_file(output_file)
            post_response = post_data(args.email, args.organization, args.project_name, resource_name, file_content)
            print(f"POST to {resource_name}: {post_response.status_code}, {post_response.text}")

        # placeholder blueprint code, replace the data with actual blueprint file
        blueprint_data = "resources"
        post_response = post_data(args.email, args.organization, args.project_name, "blueprint", blueprint_data)
        print(f"POST to blueprint: {post_response.status_code}, {post_response.text}")

        # Poke openai to process the files
        post_data_references(args.email, args.organization, args.project_name)

    else:
        print(f"Failed to create project. Server responded with: {response.status_code}, {response.text}")


if __name__ == "__main__":
    main()
