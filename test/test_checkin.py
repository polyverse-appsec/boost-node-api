import unittest
import requests

import time
from utils import get_signed_headers


class BoostBackendCheckinSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}

    def test_strong_authn(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(self.EMAIL)

        data = {"resources": ["resource1", "resource2"]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_user_account(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(self.EMAIL)

        response = requests.get(f"{self.BASE_URL}/api/user/org123/account", None, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        account = response.json()
        self.assertTrue(account["enabled"])

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
        self.assertEqual(response.json(), {"goal": "goal value"})

    def test_update_project(self):
        print("Running test: Updating project data")
        data = {"guidelines": "bruddah"}
        response = requests.patch(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_task_generator_launch(self):
        print("Running test: launch a generator")

        # create a sample project to test with
        data = {"resources": [{"uri": "http://www.github.com/public-apis/public-apis"}]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)
        if response.json()['status'] != "idle":
            print("Generator is not idle, so test results may be compromised - continuing anyway")

            # try to idle the task generator
            response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", json={"status": "processing"}, headers=self.HEADERS)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

            # check the generator state to make sure its idle
            response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=self.HEADERS)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

        # start the task generator
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", json={"status": "processing"}, headers=self.HEADERS)
        self.assertTrue(response.status_code == 202 or response.status_code == 200)
        self.assertTrue(response.json()["status"] == "processing" or response.json()["status"] == "idle")

        # we'll loop until the generator is idle or in an error state - for 30 seconds max
        #       every second, we'll do a GET and check its state
        #       if it's idle, we'll break out of the loop and pass the test
        #       if it's in an error state, we'll break out of the loop and fail the test
        #       if it's still processing, we'll continue looping
        #       each loop, we'll print the current generator state
        for i in range(15):
            response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=self.HEADERS)
            self.assertEqual(response.status_code, 200)
            self.assertIn(response.json()["status"], ["idle", "processing", "error"])
            print(f"Check {i}:\n\t{response.json()}")
            if response.json()["status"] == "idle":
                break
            if response.json()["status"] == "error":
                break
            time.sleep(2)
        self.assertEqual(response.json()["status"], "idle")

        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)
        data = response.text
        self.assertIsNotNone(data)

    # def test_store_resource_in_project(self):
    #     print("Running test: Store resource in project")
    #     data = {"resource data": "data value for resource"}
    #     response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/files", json=data, headers=self.HEADERS)
    #     self.assertEqual(response.status_code, 200)

    # def test_retrieve_resource_from_project(self):
    #     print("Running test: Retrieving resource from project")
    #     response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/files", headers=self.HEADERS)
    #     self.assertEqual(response.status_code, 200)
