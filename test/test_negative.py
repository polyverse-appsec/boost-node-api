import unittest
import requests
import time

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, PUBLIC_PROJECT, TEST_ORG, PUBLIC_PROJECT_NAME, TEST_PROJECT_NAME, FREE_EMAIL, FREE_ORG, FREE_PROJECT_NAME, PRIVATE_PROJECT


class NegativeTestsServiceSuite(unittest.TestCase):

    def test_no_content_type_project_post(self):
        print("Running test: No Content-Type header on project POST")
        headers = get_signed_headers(self.EMAIL)

        data = {
            'resources': [{'uri': PUBLIC_PROJECT}]
        }
        response = requests.post(f"{self.BASE_URL}/api/user_project/{TEST_ORG}/{PUBLIC_PROJECT_NAME}", data=data, headers=headers)
        self.assertEqual(response.text, "Invalid JSON")
        self.assertEqual(response.status_code, 400)

    def test_user_profile_no_input(self):
        print("Running test: user profile put no data")
        headers = get_signed_headers(self.EMAIL)

        response = requests.put(f"{self.BASE_URL}/api/user/profile", None, headers=headers)
        self.assertEqual(response.status_code, 400)

    def test_store_nonexisting_repo_in_project(self):
        print("Running test: Store data in the user's project")
        data = {"resources": [{"uri": "http://www.github.com/missing_org/this-repo-does-not-exist/"}]}
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/{TEST_ORG}/{TEST_PROJECT_NAME}", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_unpaid_user_accessing_private_repo(self):
        print("Running test: Create project with private repo as Unpaid User")
        data = {"resources": [{"uri": PRIVATE_PROJECT}]}
        signedHeaders = get_signed_headers(FREE_EMAIL)
        # measure the time it takes for the post
        start_time = time.time()
        response = requests.post(f"{TARGET_URL}/api/user_project/{FREE_ORG}/{FREE_PROJECT_NAME}", json=data, headers=signedHeaders)
        end_time = time.time()
        print(f"Time to create inaccessible project: {end_time - start_time}")
        self.assertEqual(response.status_code, 401)

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/{FREE_ORG}/{FREE_PROJECT_NAME}", headers=signedHeaders)
        self.assertEqual(response.status_code, 404)
