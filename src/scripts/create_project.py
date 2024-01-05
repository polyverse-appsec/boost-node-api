import argparse
import requests
import time
import jwt
import boto3

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

def create_project(email, organization, github_uri, project_name=None):
    BASE_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"
    HEADERS = {'x-user-account': email}

    private_key = get_private_key()

    expiration_unix_time = int(time.time()) + 60
    unsignedIdentity = {"email": email, "expires": expiration_unix_time}
    signedIdentity = jwt.encode(unsignedIdentity, private_key, algorithm='RS256')
    signedHeaders = {'x-signed-identity': signedIdentity}

    data = {"resources": [github_uri]}

    response = requests.post(f"{BASE_URL}/api/user_project/{organization}/{project_name}", json=data, headers=signedHeaders)
    return response
    
def main():
    parser = argparse.ArgumentParser(description='Create a project with user info.')
    parser.add_argument('email', type=str, help='Email of the user')
    parser.add_argument('organization', type=str, help='Organization name')
    parser.add_argument('github_uri', type=str, help='URI to GitHub repository')
    parser.add_argument('--project_name', type=str, default=None, help='Project name (optional)')
    args = parser.parse_args()

    # Print the user information
    print(f"User Email: {args.email}")
    print(f"Organization: {args.organization}")
    print(f"GitHub URI: {args.github_uri}")
    if args.project_name:
        print(f"Project Name: {args.project_name}")

    response = create_project(args.email, args.organization, args.github_uri, args.project_name)
    print(f"Project creation response: {response.status_code}, {response.text}")


if __name__ == "__main__":
    main()