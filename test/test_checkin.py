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
            signedHeaders = get_signed_headers(PREMIUM_EMAIL if PREMIUM_EMAIL else EMAIL)
            public_git_project = PUBLIC_PROJECT
            project_name = PUBLIC_PROJECT_NAME_CHECKIN_TEST

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        if response.status_code == 200:

            # we're going to iterate over the 3 resources (blueprint, projectsource, aispec) and delete each of them
            for resource in ["blueprint", "projectsource", "aispec"]:
                # delete the generator
                response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource}/generator", headers=signedHeaders)
                self.assertEqual(response.status_code, 200)

                # delete the resource
                response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource}", headers=signedHeaders)
                self.assertEqual(response.status_code, 200)

            # delete the project
            response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
            self.assertEqual(response.status_code, 200)

        project_data = {"resources": [{"uri": public_git_project}]}
        project_creation_time = time.time()
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=project_data, headers=signedHeaders)
        project_creation_time = time.time() - project_creation_time
        print(f"Project Creation Time: {project_creation_time} seconds")
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        gotten_project_data = response.json()
        self.assertEqual(gotten_project_data['name'], project_name)
        self.assertEqual(gotten_project_data['resources'][0]['uri'], public_git_project)

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
            if project_status['status'] == "Unknown":
                print(f"Project Status is Unknown - {response.json()}")
                break

            if project_status['synchronized'] is True:
                print(f"Project is Fully Synchronized in {i * 20} seconds - {response.json()}")
                break

            else:

                print(f"\tFull Project Status is {response.json()}")

                # if our project data is out of date on AI servers- then we can poke the AI content sync endpoint to force a sync
                if project_status['status'] == "AI Data Out of Date":
                    print("Forcing AI Data Sync")
                    response = requests.post(f"{TARGET_URL}/api/user_project/polyverse-appsec/sara/data_references", headers=signedHeaders)
                    self.assertEqual(response.status_code, 200)
                    print("AI Sync completed - rechecking in 20 seconds")
                else:
                    print(f"Project status is {project_status['status']}, waiting 20 seconds")

                    if not project_status['activelyUpdating']:
                        print("Project is not actively updating, something is wrong")

                    self.assertTrue(project_status['activelyUpdating'])

            # wait 20 seconds before probing again
            time.sleep(20)

    def test_user_project_resource_creation_public_project(self):
        return self.helper_test_user_project_resource_creation_project(private=False)

    def test_user_project_resource_creation_private_project(self):
        return self.helper_test_user_project_resource_creation_project(private=True)
