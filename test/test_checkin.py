import unittest
import requests
import json

from utils import get_signed_headers

from constants import TARGET_URL, ORG, PREMIUM_EMAIL, PUBLIC_PROJECT, PRIVATE_PROJECT


class BoostBackendCheckinSuite(unittest.TestCase):

    def test_user_profile(self):
        print("Running test: Build User profile and verify")
        headers = get_signed_headers(PREMIUM_EMAIL)

        response = requests.get(f"{TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        profile = {
            "name": "Unit Tester",
            "title": "QA Engineer",
            "details": "I am a QA Engineer",
        }

        response = requests.put(f"{TARGET_URL}/api/user/profile", json.dumps(profile), headers=headers)
        self.assertEqual(response.status_code, 200)
        puttedData = response.json()
        self.assertEqual(puttedData['name'], profile['name'])
        self.assertEqual(puttedData['title'], profile['title'])
        self.assertEqual(puttedData['details'], profile['details'])

        response = requests.get(f"{TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertEqual(gettedData['name'], profile['name'])
        self.assertEqual(gettedData['title'], profile['title'])
        self.assertEqual(gettedData['details'], profile['details'])

        response = requests.delete(f"{TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertFalse('name' in gettedData)
        self.assertFalse('title' in gettedData)
        self.assertFalse('details' in gettedData)

    def test_user_project_resource_creation_public_project(self):
        print("Running test: Create Project, Attach GitHub Resources")

        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        project_name = "checkin_test"
        public_git_project = PUBLIC_PROJECT

        response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": public_git_project}]}
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=project_data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], public_git_project)

    def test_user_project_resource_creation_private_project(self):
        print("Running test: Create Project, Attach GitHub Resources")

        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        project_name = "checkin_test"
        private_git_project = PRIVATE_PROJECT

        response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": private_git_project}]}
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=project_data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], private_git_project)
