// netlify/functions/create-subscription.js

// This function securely creates a subscription record in Firestore.
// It requires firebase-admin for backend operations.
// You'll need to add "firebase-admin" to your project's package.json

const admin = require('firebase-admin');

// IMPORTANT: Store your Firebase Service Account credentials as Netlify environment variables.
// Do NOT hardcode them here.
// 1. In your Firebase project settings, go to "Service accounts" and generate a new private key.
// 2. In your Netlify site settings, go to "Build & deploy" -> "Environment".
// 3. Add these environment variables:
//    - FIREBASE_PROJECT_ID
//    - FIREBASE_CLIENT_EMAIL
//    - FIREBASE_PRIVATE_KEY (copy the entire key, including the "-----BEGIN PRIVATE KEY-----" parts)

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // The private key needs to be parsed correctly from the environment variable.
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const auth = admin.auth();

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, planId } = JSON.parse(event.body);

    if (!email || !planId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or planId' }) };
    }

    // Get or create the user in Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // For this system, we assume the user has already signed up in the main app.
        // If not, you could create a user here, but it's better to ensure they exist first.
        return { statusCode: 404, body: JSON.stringify({ error: 'User not found. Please sign up in the tool first.' }) };
      }
      throw error;
    }

    const userId = userRecord.uid;
    const startDate = new Date();
    let endDate = new Date();

    // Calculate end date based on the plan
    switch (planId) {
      case 'trial':
        endDate.setDate(startDate.getDate() + 14);
        break;
      case 'monthly':
        endDate.setMonth(startDate.getMonth() + 1);
        break;
      case 'six-months':
        endDate.setMonth(startDate.getMonth() + 6);
        break;
      case 'yearly':
        endDate.setFullYear(startDate.getFullYear() + 1);
        break;
      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid planId' }) };
    }

    // Store subscription details in Firestore
    const subscriptionRef = db.collection('subscriptions').doc(userId);
    await subscriptionRef.set({
      userId: userId,
      userEmail: email,
      planId: planId,
      startDate: admin.firestore.Timestamp.fromDate(startDate),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Subscription created successfully.' }),
    };

  } catch (error) {
    console.error('Error in create-subscription function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An internal server error occurred.' }),
    };
  }
};
