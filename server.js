// --- Imports ---
const admin = require('firebase-admin');
const createApp = require('./app'); // NEW: Import the core application logic

// --- Configuration & Initialization ---
const PORT = process.env.PORT || 8080; 

// Initialize Firebase Admin SDK for Firestore using Cloud Run's default credentials.
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), 
  });
  console.log('Firebase Admin SDK initialized successfully using Application Default Credentials (Cloud Run).');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error.message);
}

const db = admin.firestore(); 

// --- Create and Start App ---
const app = createApp(db, admin);

app.listen(PORT, () => {
  console.log(`Cloud Run Backend is running and connected to Firestore on port ${PORT}.`);
});