// Netlify Function: create-subscription.js
// This function finds an existing user or creates a new one for a free trial,
// then creates a subscription document for them in Firestore.

const admin = require('firebase-admin');

let db, auth;

// This block initializes the connection to your Firebase database.
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    }
    db = admin.firestore();
    auth = admin.auth();
} catch (e) {
    console.error("CRITICAL ERROR: Firebase admin initialization FAILED. Check your environment variables.", e);
}

exports.handler = async (event) => {
  // *** FIX: DYNAMICALLY HANDLE CORS FOR ANY AFFILIATE LINK ***

  // IMPORTANT: Replace this placeholder with the actual URL of your deployed payment page.
  // You can add more URLs to this list if needed (e.g., for local testing).
  const allowedOrigins = [
    'https://traderlog5.netlify.app',
    // 'http://localhost:8888' // Example for local development
  ];

  const requestOrigin = event.headers.origin;
  let headers = {};

  // Check if the incoming request's origin is in our list of approved sites.
  if (allowedOrigins.includes(requestOrigin)) {
    headers = {
      'Access-Control-Allow-Origin': requestOrigin, // Respond with the specific origin that made the request
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
  }
  
  // The browser sends an OPTIONS request first to check permissions.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!db || !auth) {
      console.error("Firebase Admin SDK not initialized. This is likely due to missing or incorrect environment variables.");
      return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Server configuration error. Please contact support." })
      };
  }
  
  if (event.httpMethod !== 'POST') {
    return { 
        statusCode: 405, 
        headers,
        body: 'Method Not Allowed' 
    };
  }

  try {
    const { planId, email, name, phone, affiliateId } = JSON.parse(event.body);

    if (!planId || !email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: planId and email.' }) };
    }

    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`SUCCESS: Found existing user with UID: ${userRecord.uid}`);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            if (planId === 'trial') {
                console.log(`User not found for 'trial' plan. Creating new account for ${email}.`);
                try {
                    userRecord = await auth.createUser({ email, displayName: name || '' });
                    console.log(`SUCCESS: Created new user for trial with UID: ${userRecord.uid}`);
                } catch (creationError) {
                    console.error(`ERROR: Failed to create new user during trial signup for email: ${email}`, creationError);
                    return { statusCode: 500, headers, body: JSON.stringify({ error: `Could not create account: ${creationError.message}` }) };
                }
            } else {
                console.error(`ERROR: User not found for paid plan (${planId}) with email: ${email}.`);
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: `Account for ${email} not found. Please sign up in the Trading Journal before buying a plan.` })
                };
            }
        } else {
            console.error(`ERROR: An unexpected authentication error occurred for email: ${email}`, error);
            throw error;
        }
    }
    
    const uid = userRecord.uid;
    const now = new Date();
    let endDate = new Date();
    let durationDays = 0;

    switch (planId) {
      case 'trial': durationDays = 14; break;
      case 'monthly': durationDays = 30; break;
      case 'six-months': durationDays = 180; break;
      case 'yearly': durationDays = 365; break;
      default:
        console.error(`ERROR: Invalid planId received: ${planId}`);
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
    }
    
    endDate.setDate(now.getDate() + durationDays);

    const subscriptionData = {
      planId,
      userId: uid,
      userEmail: email,
      userName: name || null,
      userPhone: phone || null,
      affiliateId: affiliateId || 'direct',
      startDate: admin.firestore.Timestamp.fromDate(now),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('subscriptions').doc(uid).set(subscriptionData, { merge: true });
    console.log(`SUCCESS: Subscription created/updated for UID: ${uid}, Plan: ${planId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Subscription activated successfully.' }),
    };

  } catch (error) {
    console.error('CRITICAL ERROR: Unhandled exception in handler.', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'An internal server error occurred. Could not activate subscription.' }),
    };
  }
};

