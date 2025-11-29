Deployment Guide: Cloud Run and Firestore Backend

Your Next Steps (Action Items)

Step 1: Local Setup

Create Folder: Open your terminal and create a directory:

mkdir school-api-backend
cd school-api-backend


Save Files: Place the four files above (package.json, users_init.json, server.js, Dockerfile) into this new school-api-backend folder.

// gcloud config set project aacharya-mobile

Step 2: Deployment

Run the following command in your terminal from inside the school-api-backend folder:

# Replace [YOUR_REGION] with your desired Google Cloud region (e.g., us-central1)

<!-- CREATE ARTIFACT -->
  gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker \
  --location=europe-west1 \
  --description="Repository for Cloud Run Source Deployments (Created by User)"

  gcloud run deploy school-api-backend \
  --source . \
  --region eu-west1 \
  --platform managed \
  --allow-unauthenticated \
  --image europe-west1-docker.pkg.dev/[YOUR_PROJECT_ID]/cloud-run-source-deploy/school-api-backend

  gcloud artifacts repositories create cloud-run-source-deploy --repository-format=docker --location=europe-west1 --description="Repository for Cloud Run Source Deployments (Created by User)"

  gcloud run deploy school-api-backend --source . --region europe-west1 --platform managed --allow-unauthenticated --image europe-west1-docker.pkg.dev/aacharya-mobile/cloud-run-source-deploy/school-api-backend


Output: This command will provide your Service URL.

Step 3: Firestore Index Creation (CRITICAL)

The first time you test the login API (next step), it will likely fail because the email field needs an index to support the where('email', '==', email) query.

Check the Cloud Run logs in the Google Cloud Console. The error message will contain a direct link to create the required index.

Action: Click the link and create the index on the email field in the users collection. Wait for the index to build (approx. 1-5 minutes).

Step 4: Test the Login API

Use your Service URL to test the login with a POST request (using Postman, cURL, etc.).

Field

Value

URL

[Service URL]/login

Method

POST

Body (JSON)

{"email": "teacher@jpschool.com", "password": "teacherpass"}

Next Feature to Build

Once deployment is successful, we should build an API to fetch user-specific data and implement Authentication Middleware.