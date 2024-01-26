import unittest
import requests
import json
import time

from utils import get_signed_headers

from constants import TARGET_URL, ORG, PREMIUM_EMAIL, PUBLIC_PROJECT, PRIVATE_PROJECT, EMAIL, PRIVATE_PROJECT_NAME_CHECKIN_TEST, PUBLIC_PROJECT_NAME_CHECKIN_TEST


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

    def helper_test_user_project_resource_creation_project(self, private: bool):
        if private:
            print("Running test: Create Project, Attach GitHub Private Resources")
        else:
            print("Running test: Create Project, Attach GitHub Public Resources")

        if private:
            signedHeaders = get_signed_headers(PREMIUM_EMAIL)
            public_git_project = PRIVATE_PROJECT
            project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST
        else:
            signedHeaders = get_signed_headers(EMAIL)
            public_git_project = PUBLIC_PROJECT
            project_name = PUBLIC_PROJECT_NAME_CHECKIN_TEST

        response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": public_git_project}]}
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=project_data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], public_git_project)

        # now we're going to loop every 20 seconds to see if the project status has completed synchronized - up to 120 seconds
        # if it hasn't, we'll fail the test
        for i in range(0, 30):
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/status", headers=signedHeaders)
            self.assertEqual(response.status_code, 200)

            gotten_project_data = response.json()
            if gotten_project_data['synchronized']:
                print(f"Project is Fully Synchronized in {i * 15} seconds - {response.json()}")
                break
            else:
                print(f"Project status is {gotten_project_data['status']}, waiting 15 seconds")
                print(f"\tFull Project Status is {response.json()}")

            # wait 20 seconds before probing again
            time.sleep(20)

    def test_user_project_resource_creation_public_project(self):
        return self.helper_test_user_project_resource_creation_project(private=False)

    def test_user_project_resource_creation_private_project(self):
        return self.helper_test_user_project_resource_creation_project(private=True)
