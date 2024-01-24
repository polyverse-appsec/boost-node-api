import unittest
import requests
import datetime
import json

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, ORG, PUBLIC_PROJECT, PUBLIC_PROJECT_NAME, PREMIUM_EMAIL, PRIVATE_PROJECT_NAME_CHECKIN_TEST


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

    def test_api_version(self):
        print("Running test: check version of service")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/status", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()['version'], None)
        self.assertEqual(response.json()['type'], 'dev')
        self.assertEqual(response.json()['status'], 'available')

    def test_check_resource_status(self):
        print("Running test: Store data in the user's project")
        data = {"resources": [{"uri": PUBLIC_PROJECT}]}
        signedHeaders = get_signed_headers(EMAIL)

        # get current time in seconds / unix time
        now = datetime.datetime.now()
        unixtime = int(now.timestamp())

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test/data/blueprint", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.text, None)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test/data/blueprint/status", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()['last_updated'], None)
        self.assertGreater(response.json()['last_updated'], unixtime)

    def test_generator_resource_projectsource_stage_filescan(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan")

        project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST

        data = {"stage": 'File Paths Scan'}
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        # response = requests.post(f"{TARGET_URL}/test", json=data, headers=signedHeaders)
        # self.assertEqual(response.status_code, 200)

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource/generator/process", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = response.text

        self.assertEqual(response, 'Full Source Code Import')
