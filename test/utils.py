import jwt
import time
import boto3


def get_signed_headers(email):
    private_key = get_private_key()

    # create an unsigned object that expires in 60 seconds from now (unix system time + 60 seconds)
    expiration_unix_time = int(time.time()) + 60

    # create an unsigned object that expires in 15 seconds from now (unix system time + 15 seconds)
    unsigedIdentity = {"email": email, "expires": expiration_unix_time}

    # Create the JWT token
    signedIdentity = jwt.encode(unsigedIdentity, private_key, algorithm='RS256')

    signedHeaders = {'x-signed-identity': signedIdentity}

    return signedHeaders


def get_private_key():

    secret_name = "boost-sara/sara-client-private-key"
    region_name = "us-west-2"

    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    get_secret_value_response = client.get_secret_value(
        SecretId=secret_name
    )

    # Decrypts secret using the associated KMS key.
    private_key = get_secret_value_response['SecretString']

    return private_key
