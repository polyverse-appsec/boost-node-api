import unittest
import requests
import time

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, ORG, PUBLIC_PROJECT_NAME


class End2EndTestSuite(unittest.TestCase):

    def test_task_generator_launch_blueprint(self):
        self.helper_task_generator_launch("blueprint")

    def test_task_generator_launch_projectsource(self):
        self.helper_task_generator_launch("projectsource")

    def test_task_generator_launch_aispec(self):
        self.helper_task_generator_launch("aispec")

    def helper_task_generator_launch(self, resource_type):
        print(f"Running test: launch a generator for a {resource_type} resource")

        headers = get_signed_headers(EMAIL)

        # cleanup resources
        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}", headers=headers)
        if response.status_code == 200:
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}", headers=headers)
            if response.status_code == 200:
                response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}", headers=headers)
                self.assertTrue(response.status_code == 200 or response.status_code == 404)

            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", headers=headers)
            if response.status_code == 200:
                response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", headers=headers)
                self.assertTrue(response.status_code == 200 or response.status_code == 404)

        # response = requests.delete(f"{self.BASE_URL}/api/user_project/org123/project456/data_references", headers=headers)
        # self.assertEqual(response.status_code, 200)

        # create a sample project to test with
        data = {"resources": [{"uri": "http://www.github.com/public-apis/public-apis"}]}
        response = requests.put(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}", json=data, headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", headers=headers)
        self.assertEqual(response.status_code, 200)
        if response.json()['status'] != "idle":
            print("Generator is not idle, so test results may be compromised - continuing anyway")

            # try to idle the task generator
            response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", json={"status": "idle"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

            # check the generator state to make sure its idle
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

        # start the task generator
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", json={"status": "processing"}, headers=headers)
        self.assertTrue(response.status_code == 202 or response.status_code == 200)
        self.assertTrue(response.json()["status"] == "processing" or response.json()["status"] == "idle")

        # we need to make sure the resource is generated immediately - even if further updates will happen
        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.text
        self.assertIsNotNone(data)

        # we'll loop until the generator is idle or in an error state - for 30 seconds max
        #       every second, we'll do a GET and check its state
        #       if it's idle, we'll break out of the loop and pass the test
        #       if it's in an error state, we'll break out of the loop and fail the test
        #       if it's still processing, we'll continue looping
        #       each loop, we'll print the current generator state
        # for i in range(48):
        i = 0
        while True:
            i += 1
            print(f"Checking {resource_type} Resource/Generator #{i}")

            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertIn(response.json()["status"], ["idle", "processing", "error"])

            print(f"Check {i}:\n\t{response.json()}")

            # if the generator is idle or an error, we'll exit the loop
            # otherwise, keep 'processing'
            if response.json()["status"] == "idle":
                break
            if response.json()["status"] == "error":
                break

            # make sure the blueprint resource is still available
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}", headers=headers)
            self.assertEqual(response.status_code, 200)
            data = response.text
            self.assertIsNotNone(data)

            # wait a couple seconds before re-sampling
            time.sleep(5)
        self.assertEqual(response.json()["status"], "idle")

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}/data/{resource_type}", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.text
        self.assertIsNotNone(data)
