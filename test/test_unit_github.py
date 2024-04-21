import unittest
import requests
import json
import time

from utils import get_signed_headers

from constants import (
    TARGET_URL,
    EMAIL,
    PREMIUM_EMAIL,
    ORG, BASIC_EMAIL,
    BASIC_EMAIL_WITH_GITHUB_APP,
    PRIVATE_PROJECT, PUBLIC_PROJECT,
    PRIVATE_PROJECT_CUSTOM_NFTMINT,
    PRIVATE_PROJECT_LARGE,
    PRIVATE_PROJECT_MEDIUM,
)


class GitHubUnitTestSuite(unittest.TestCase):

    def test_retrieve_file(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri={PUBLIC_PROJECT}/blob/master/scripts/validate/links.py", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_file_private_access(self):
        print("Running test: Retrieve a private file from the team's project")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri={PRIVATE_PROJECT}/blob/main/README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_public_repo_access(self):
        print("Running test: Retrieve full source from a public repo")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri={PUBLIC_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_private_repo_access(self):
        print("Running test: Retrieve full source from a private repo")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_private_large_repo_access(self):
        print("Running test: Retrieve full source from a private repo LARGE")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        startTime = time.time()
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri={PRIVATE_PROJECT_LARGE}", headers=signedHeaders)
        endTime = time.time()
        print(f"Time to retrieve full source from a private repo LARGE: {endTime - startTime}")
        self.assertEqual(response.status_code, 200)

    def test_retrieve_fullsource_private_medium_repo_access(self):
        print("Running test: Retrieve full source from a private repo MEDIUM")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        # add the Accept-Encoding gzip header to the request
        signedHeaders['Accept-Encoding'] = 'gzip'
        startTime = time.time()
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri={PRIVATE_PROJECT_MEDIUM}", headers=signedHeaders)
        endTime = time.time()
        print(f"Time to retrieve full source from a private repo LARGE: {endTime - startTime}")
        self.assertEqual(response.status_code, 200)
        responseObj = response.json() if 'body' not in response else json.loads(response['body'])
        print(f"Length of response: {len(responseObj)}")

    def test_retrieve_fullsource_private_custom_repo_access(self):
        print("Running test: Retrieve full source from nftmint repo")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        startTime = time.time()
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/fullsource?uri={PRIVATE_PROJECT_CUSTOM_NFTMINT}", headers=signedHeaders)
        endTime = time.time()
        print(f"Time to retrieve full source from a private repo LARGE: {endTime - startTime}")
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response else json.loads(response['body'])
        self.assertTrue(response)
        self.assertTrue(len(response) > 4000)

    def test_retrieve_file_private_access_repo_path(self):
        print("Running test: Retrieve a private file from the team's project based on repo and path")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?repo={PRIVATE_PROJECT}/&path=README.md", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_premium_user_access_to_private_repo_success(self):
        print("Running test: Check that premiumuser  WITH access to private repo can see it")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response else json.loads(response['body'])
        self.assertTrue(response)

    def test_premium_user_access_to_private_repo_fail(self):
        print("Running test: Check that premium user WITHOUT access to private repo can see it - no app install")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 500)
        response = response.text if 'body' not in response else response['body']
        self.assertTrue("GitHub App Installation not found" in response)

    def test_basic_user_access_to_private_repo_fail_no_app(self):
        print("Running test: Check that Basic user WITHOUT access to private repo can see it - no app install")
        signedHeaders = get_signed_headers(BASIC_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 500)
        response = response.text if 'body' not in response else response['body']
        self.assertTrue("GitHub App Installation not found" in response)

    def test_basic_user_access_to_private_repo_fail(self):
        print("Running test: Check that Basic user WITHOUT access to private repo can see it")
        signedHeaders = get_signed_headers(BASIC_EMAIL_WITH_GITHUB_APP)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/access?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response else json.loads(response['body'])
        self.assertTrue(not response)

    def test_retrieve_folders_public(self):
        print("Running test: Retrieve all folders from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/folders?uri={PUBLIC_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 3)

    def test_retrieve_folders_private(self):
        print("Running test: Retrieve all folders from a private project")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/folders?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 40)

    def test_retrieve_folders_private_large(self):
        print("Running test: Retrieve all folders from a private project LARGE")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/folders?uri={PRIVATE_PROJECT_LARGE}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        folders = response.json()
        self.assertGreaterEqual(len(folders), 119)

    def test_retrieve_files(self):
        print("Running test: Retrieve all files from a public project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/files?uri={PUBLIC_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        self.assertGreaterEqual(len(files), 22)

    def test_retrieve_files_private(self):
        print("Running test: Retrieve all files from a private project")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/files?uri={PRIVATE_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        files = files if 'body' not in files else json.loads(files['body'])
        self.assertGreaterEqual(len(files), 136)

    def test_retrieve_files_private_large(self):
        print("Running test: Retrieve all files from a private project with LARGE amount of data")
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/files?uri={PRIVATE_PROJECT_LARGE}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json())
        files = response.json()
        files = files if 'body' not in files else json.loads(files['body'])
        self.assertGreaterEqual(len(files), 4889)

    def test_retrieve_invalid_uri(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri=example.com", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)

    def test_retrieve_github_repo(self):
        print("Running test: Retrieve a file from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/connectors/github/file?uri={PUBLIC_PROJECT}", headers=signedHeaders)
        self.assertEqual(response.status_code, 400)
