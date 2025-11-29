// --- Imports ---
const admin = require('firebase-admin');
const fs = require('fs'); 
const createApp = require('./app'); // NEW: Import the core application logic

// --- Configuration & Initialization ---
const PORT = 8080; 
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';

// --- FIREBASE LOCAL INITIALIZATION ---
try {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('\n*** CRITICAL ERROR: Local service account key not found! ***');
    process.exit(1); 
  }
  
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  
  // NOTE: We initialize admin once here, which is passed to createApp
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  console.log('Firebase Admin SDK initialized successfully using local credentials.');
} catch (error) {
  console.error('\n*** UNEXPECTED ERROR during Firebase initialization. Check serviceAccountKey.json validity. ***');
  console.error(`Error details: ${error.message}\n`);
  process.exit(1);
}

const db = admin.firestore(); 

// --- Create and Start App ---
const app = createApp(db, admin);

app.listen(PORT, () => {
  console.log(`Local Backend is running and connected to Firestore on http://localhost:${PORT}`);
});