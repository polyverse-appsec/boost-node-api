import unittest
import requests
import json
import time

from utils import get_signed_headers

from constants import TARGET_URL, ORG, PREMIUM_EMAIL, PUBLIC_PROJECT, PRIVATE_PROJECT, EMAIL, PRIVATE_PROJECT_NAME_CHECKIN_TEST, PUBLIC_PROJECT_NAME_CHECKIN_TEST, PRIVATE_PROJECT_LARGE, PRIVATE_PROJECT_LARGE_NAME


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

    def helper_test_user_project_resource_creation_project(self, private: bool, project_name: str = None, git_project: str = None):
        if private:
            print("Running test: Create Project, Attach GitHub Private Resources")
            if project_name:
                print(f"Project Name: {project_name}")
            if git_project:
                print(f"Git Project: {git_project}")
        else:
            print("Running test: Create Project, Attach GitHub Public Resources")
            if project_name:
                print(f"Project Name: {project_name}")
            if git_project:
                print(f"Git Project: {git_project}")

        if private:
            signedHeaders = get_signed_headers(PREMIUM_EMAIL)
            git_project = PRIVATE_PROJECT if git_project is None else git_project
            project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST if project_name is None else project_name
        else:
            signedHeaders = get_signed_headers(PREMIUM_EMAIL if PREMIUM_EMAIL else EMAIL)
            git_project = PUBLIC_PROJECT if git_project is None else git_project
            project_name = PUBLIC_PROJECT_NAME_CHECKIN_TEST if project_name is None else project_name

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        if response.status_code == 200:
            
            # delete the project
            response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
            self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": git_project}]}
        project_creation_time = time.time()
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=project_data, headers=signedHeaders)
        project_creation_time = time.time() - project_creation_time
        print(f"Project Creation Time: {project_creation_time} seconds")
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        gotten_project_data = gotten_project_data if 'body' not in gotten_project_data else json.loads(gotten_project_data['body'])
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], git_project)

        # now we're going to loop every 20 seconds to see if the project status has completed synchronized
        # if it hasn't, we'll fail the test
        # we wait a maximum length based on size of project
        # 5 minutes for 20-30 resources; 15-20 minutes for 100-150 resources
        iterations_in_one_min = 3
        max_iterations_public = iterations_in_one_min * 5
        max_iterations_private = iterations_in_one_min * 15
        for i in range(0, max_iterations_private if private else max_iterations_public):
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/status", headers=signedHeaders)
            self.assertEqual(response.status_code, 200)

            project_status = response.json()
            project_status = project_status if 'body' not in project_status else json.loads(project_status['body'])
            if project_status['status'] == "Unknown":
                print(f"Project Status is Unknown - {response.json()}")
                break

            if project_status['synchronized'] is True:
                print(f"Project is Fully Synchronized in {i * 20} seconds - {response.json()}")
                break

            else:

                print(f"\tFull Project Status is {response.json()}")

                # if our project data is out of date on AI servers- then we can poke the AI content sync endpoint to force a sync
                print(f"Project status is {project_status['status']}, waiting 20 seconds")

                if not project_status['activelyUpdating']:
                    print("Project is not actively updating, something is wrong")

                self.assertTrue(project_status['activelyUpdating'])

            # wait 20 seconds before probing again
            time.sleep(20)

        print("Project is Fully Synchronized - Test success!")

        # refresh the data_references (and associated openai files)
        response = requests.put(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data_references", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_user_project_resource_creation_public_project(self):
        self.helper_test_user_project_resource_creation_project(private=False)

    def test_user_project_resource_creation_private_project(self):
        self.helper_test_user_project_resource_creation_project(private=True)

    def test_user_project_resource_creation_private_large_project(self):
        self.helper_test_user_project_resource_creation_project(private=True, git_project=PRIVATE_PROJECT_LARGE, project_name=PRIVATE_PROJECT_LARGE_NAME)
