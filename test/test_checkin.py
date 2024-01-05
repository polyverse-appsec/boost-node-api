import unittest
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


class BoostBackendCheckinSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}

    def test_strong_authn(self):
        print("Running test: Strong authentication")

        private_key = get_private_key()

        # create an unsigned object that expires in 60 seconds from now (unix system time + 60 seconds)
        expiration_unix_time = int(time.time()) + 60

        # create an unsigned object that expires in 15 seconds from now (unix system time + 15 seconds)
        unsigedIdentity = {"email": self.EMAIL, "expires": expiration_unix_time}

        # Create the JWT token
        signedIdentity = jwt.encode(unsigedIdentity, private_key, algorithm='RS256')

        signedHeaders = {'x-signed-identity': signedIdentity}

        data = {"resources": ["resource1", "resource2"]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_resource_file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_folders(self):
        print("Running test: Retrieve all folders from a public project")
        response = requests.get(f"{self.BASE_URL}/api/user_resource_folders?uri=https://github.com/public-apis/public-apis/", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 3)

    def test_retrieve_files(self):
        print("Running test: Retrieve all files from a public project")
        response = requests.get(f"{self.BASE_URL}/api/user_resource_files?uri=https://github.com/public-apis/public-apis/", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        self.assertGreaterEqual(len(files), 22)

    def test_retrieve_invalid_uri(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_resource_file?uri=example.com", headers=self.HEADERS)
        self.assertEqual(response.status_code, 400)

    def test_retrieve_github_repo(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_resource_file?uri=https://github.com/public-apis/public-apis", headers=self.HEADERS)
        self.assertEqual(response.status_code, 400)

    def test_store_data_in_project(self):
        print("Running test: Store data in the user's project")
        data = {"resources": ["resource1", "resource2"]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_data_from_project(self):
        print("Running test: Retrieve data from the user's project")

        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json={}, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_store_goals_data_in_project(self):
        print("Running test: Store goals data in the user's project")
        data = {"goal": "goal value"}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/goals", json=data, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_goals_data_from_project(self):
        print("Running test: Retrieve goals data from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/goals", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    # def test_store_resource_in_project(self):
    #     print("Running test: Store resource in project")
    #     data = {"resource data": "data value for resource"}
    #     response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/files", json=data, headers=self.HEADERS)
    #     self.assertEqual(response.status_code, 200)

    # def test_retrieve_resource_from_project(self):
    #     print("Running test: Retrieving resource from project")
    #     response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/files", headers=self.HEADERS)
    #     self.assertEqual(response.status_code, 200)
