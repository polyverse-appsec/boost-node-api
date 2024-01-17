import unittest
import requests

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, ORG


class UnitTestSuite(unittest.TestCase):

    def test_strong_authn(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL, True)

        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_weak_authn(self):
        print("Running test: Weak authentication")

        unsignedHeader = {'x-user-account': EMAIL}

        response = requests.get(f"{TARGET_URL}/api/user/profile", headers=unsignedHeader)
        self.assertEqual(response.status_code, 200)

    def test_user_account(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL)

        response = requests.get(f"{TARGET_URL}/api/user/org123/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        account = response.json()
        self.assertTrue(account["enabled"])

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file_private_access(self):
        print("Running test: Retrieve a private file from the team's project")
        signedHeaders = get_signed_headers("stephen@polyverse.com")
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/file?uri=https://github.com/polyverse-appsec/sara/blob/main/README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file_private_access_repo_path(self):
        print("Running test: Retrieve a private file from the team's project based on repo and path")
        signedHeaders = get_signed_headers("stephen@polyverse.com")
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/file?repo=https://github.com/polyverse-appsec/sara/&path=README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_folders(self):
        print("Running test: Retrieve all folders from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/folders?uri=https://github.com/public-apis/public-apis/", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 3)

    def test_retrieve_files(self):
        print("Running test: Retrieve all files from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/files?uri=https://github.com/public-apis/public-apis/", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        self.assertGreaterEqual(len(files), 22)

    def test_retrieve_invalid_uri(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/file?uri=example.com", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)

    def test_retrieve_github_repo(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/org123/connectors/github/file?uri=https://github.com/public-apis/public-apis", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)

    def test_store_data_in_project(self):
        print("Running test: Store data in the user's project")
        data = {"resources": [{"uri": "https://github.com/sindresorhus/bro"}]}
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_data_from_project(self):
        print("Running test: Retrieve data from the user's project")

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456", json={}, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/org123/project456", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        responseData = response.json()
        self.assertEqual(responseData['name'], "project456")
        self.assertEqual(len(responseData['resources']), 0)

    def test_store_goals_data_in_project(self):
        print("Running test: Store goals data in the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        data = {"goals": "goal value"}
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456/goals", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_goals_data_from_project(self):
        print("Running test: Retrieve goals data from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/org123/project456/goals", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"goals": "goal value"})

    def test_retrieve_sara_project_data_references(self):
        print("Running test: Retrieve goals data from the user's project")
        signedHeaders = get_signed_headers('aaron@polyverse.com')
        response = requests.get(f"{TARGET_URL}/api/user_project/polyverse-appsec/sara/data_references", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        data_references = response.json()
        self.assertIsNotNone(data_references)
        self.assertIsNotNone(len(data_references) > 0)

    def test_update_project(self):
        print("Running test: Updating project data")
        signedHeaders = get_signed_headers(EMAIL)
        data = {"resources": [{"uri": "https://github.com/sindresorhus/awesome"}]}
        response = requests.patch(f"{TARGET_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
