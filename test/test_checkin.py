import unittest
import requests
import json

from utils import get_signed_headers


class BoostBackendCheckinSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    TARGET_URL = BASE_URL

    EMAIL = "stephen@polyverse.com"
    ORG = "unitestorg"

    PRIVATE_PROJECT = "https://github.com/StephenAFisher/testRepoForBoostGitHubApp"
    # PRIVATE_PROJECT = "https://github.com/polyverse-appsec/sara"
    PUBLIC_PROJECT = "https://github.com/public-apis/public-apis"

    def test_user_profile(self):
        print("Running test: Build User profile and verify")
        headers = get_signed_headers(self.EMAIL)

        response = requests.get(f"{self.TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        profile = {
            "name": "Unit Tester",
            "title": "QA Engineer",
            "details": "I am a QA Engineer",
        }

        response = requests.put(f"{self.TARGET_URL}/api/user/profile", json.dumps(profile), headers=headers)
        self.assertEqual(response.status_code, 200)
        puttedData = response.json()
        self.assertEqual(puttedData['name'], profile['name'])
        self.assertEqual(puttedData['title'], profile['title'])
        self.assertEqual(puttedData['details'], profile['details'])

        response = requests.get(f"{self.TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertEqual(gettedData['name'], profile['name'])
        self.assertEqual(gettedData['title'], profile['title'])
        self.assertEqual(gettedData['details'], profile['details'])

        response = requests.delete(f"{self.TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertFalse('name' in gettedData)
        self.assertFalse('title' in gettedData)
        self.assertFalse('details' in gettedData)

    def test_user_project_resource_creation_public_project(self):
        print("Running test: Create Project, Attach GitHub Resources")

        signedHeaders = get_signed_headers(self.EMAIL)

        project_name = "checkin_test"
        public_git_project = self.PUBLIC_PROJECT

        response = requests.delete(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": public_git_project}]}
        signedHeaders = get_signed_headers(self.EMAIL)
        response = requests.post(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", json=project_data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], public_git_project)

    def test_user_project_resource_creation_private_project(self):
        print("Running test: Create Project, Attach GitHub Resources")

        signedHeaders = get_signed_headers(self.EMAIL)

        project_name = "checkin_test"
        private_git_project = self.PRIVATE_PROJECT

        response = requests.delete(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": private_git_project}]}
        response = requests.post(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", json=project_data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.TARGET_URL}/api/user_project/{self.ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], private_git_project)
