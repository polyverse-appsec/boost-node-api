import unittest
import requests


class TestServerEndpoints(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}  # need to replace with strong private key signed test

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_project_file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_invalid_uri(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_project_file?uri=example.com", headers=self.HEADERS)
        self.assertEqual(response.status_code, 400)
    
    def test_retrieve_github_repo(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_project_file?uri=https://github.com/public-apis/public-apis", headers=self.HEADERS)
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

