import unittest
import requests
import json

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, PREMIUM_EMAIL, ORG, BASIC_EMAIL, BASIC_EMAIL_WITH_GITHUB_APP


class GitHubUnitTestSuite(unittest.TestCase):

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri=https://github.com/public-apis/public-apis/blob/master/scripts/validate/links.py", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file_private_access(self):
        print("Running test: Retrieve a private file from the team's project")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri=https://github.com/polyverse-appsec/sara/blob/main/README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_public_repo_access(self):
        print("Running test: Retrieve full source from a public repo")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri=https://github.com/public-apis/public-apis", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_private_repo_access(self):
        print("Running test: Retrieve full source from a private repo")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file_private_access_repo_path(self):
        print("Running test: Retrieve a private file from the team's project based on repo and path")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?repo=https://github.com/polyverse-appsec/sara/&path=README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_premium_user_access_to_private_repo_success(self):
        print("Running test: Check that premiumuser  WITH access to private repo can see it")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response else json.loads(response['body'])
        self.assertTrue(response)

    def test_premium_user_access_to_private_repo_fail(self):
        print("Running test: Check that premium user WITHOUT access to private repo can see it - no app install")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 500)
        response = response.text if 'body' not in response else response['body']
        self.assertTrue("GitHub App Installation not found" in response)

    def test_basic_user_access_to_private_repo_fail_no_app(self):
        print("Running test: Check that Basic user WITHOUT access to private repo can see it - no app install")
        signedHeaders = get_signed_headers(BASIC_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 500)
        response = response.text if 'body' not in response else response['body']
        self.assertTrue("GitHub App Installation not found" in response)

    def test_basic_user_access_to_private_repo_fail(self):
        print("Running test: Check that Basic user WITHOUT access to private repo can see it")
        signedHeaders = get_signed_headers(BASIC_EMAIL_WITH_GITHUB_APP)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response else json.loads(response['body'])
        self.assertTrue(not response)

    def test_retrieve_folders(self):
        print("Running test: Retrieve all folders from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/folders?uri=https://github.com/public-apis/public-apis/", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 3)

    def test_retrieve_files(self):
        print("Running test: Retrieve all files from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/files?uri=https://github.com/public-apis/public-apis/", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        self.assertGreaterEqual(len(files), 22)

    def test_retrieve_files_private(self):
        print("Running test: Retrieve all files from a public project")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/files?uri=https://github.com/polyverse-appsec/sara", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        files = files if 'body' not in files else json.loads(files['body'])
        self.assertGreaterEqual(len(files), 136)

    def test_retrieve_invalid_uri(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri=example.com", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)

    def test_retrieve_github_repo(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri=https://github.com/public-apis/public-apis", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)
