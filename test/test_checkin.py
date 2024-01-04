import unittest
import requests

class TestServerEndpoints(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Update with your server's URL
    EMAIL = "aaron@polyverse.com"  # Replace with the actual email
    HEADERS = {'x-user-account': EMAIL}

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        response = requests.get(f"{self.BASE_URL}/api/user_project_file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py", headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_store_data_in_project(self):
        print("Running test: Store data in the user's project")
        data = {"org": "myorg", "project": "myproject"}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=self.HEADERS)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_data_from_project(self):
        print("Running test: Retrieve data from the user's project")
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