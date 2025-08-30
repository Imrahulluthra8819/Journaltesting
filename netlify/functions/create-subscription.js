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
  // *** FIX: ADD INTENSIVE LOGGING AND A TEMPORARY WILDCARD FOR DEBUGGING ***

  console.log('[LOG] Function execution started.');
  
  // For debugging, we will temporarily allow all origins.
  // This helps confirm if the issue is CORS-related or something else.
  const headers = {
    'Access-Control-Allow-Origin': '*', // TEMPORARY: Allow any origin
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    console.log('[LOG] Responding to preflight OPTIONS request.');
    return { statusCode: 204, headers, body: '' };
  }

  if (!db || !auth) {
      console.error("[LOG] CRITICAL: Firebase Admin SDK not initialized. Function cannot proceed.");
      return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Server configuration error. Please contact support." })
      };
  }
  console.log('[LOG] Firebase Admin SDK is initialized.');
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
    console.log('[LOG] Successfully parsed request body:', body);
  } catch (parseError) {
    console.error('[LOG] CRITICAL: Could not parse request body.', parseError);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request format.' }) };
  }

  try {
    const { planId, email, name, phone, affiliateId } = body;

    if (!planId || !email) {
      console.error('[LOG] ERROR: Missing planId or email in request.');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: planId and email.' }) };
    }
    console.log(`[LOG] Processing request for email: ${email}, plan: ${planId}`);

    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`[LOG] SUCCESS: Found existing user with UID: ${userRecord.uid}`);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            if (planId === 'trial') {
                console.log(`[LOG] User not found for 'trial' plan. Creating new account for ${email}.`);
                userRecord = await auth.createUser({ email, displayName: name || '' });
                console.log(`[LOG] SUCCESS: Created new user for trial with UID: ${userRecord.uid}`);
            } else {
                console.error(`[LOG] ERROR: User not found for paid plan (${planId}) with email: ${email}.`);
                return {
                    statusCode: 404, headers,
                    body: JSON.stringify({ error: `Account for ${email} not found. Please sign up in the Trading Journal before buying a plan.` })
                };
            }
        } else {
            console.error(`[LOG] ERROR: An unexpected authentication error occurred for email: ${email}`, error);
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
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
    }
    
    endDate.setDate(now.getDate() + durationDays);
    console.log(`[LOG] Subscription for UID ${uid} will end on: ${endDate.toISOString()}`);

    const subscriptionData = {
      planId, userId: uid, userEmail: email, userName: name || null,
      userPhone: phone || null, affiliateId: affiliateId || 'direct',
      startDate: admin.firestore.Timestamp.fromDate(now),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('subscriptions').doc(uid).set(subscriptionData, { merge: true });
    console.log(`[LOG] SUCCESS: Subscription document created/updated in Firestore for UID: ${uid}`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, message: 'Subscription activated successfully.' }),
    };

  } catch (error) {
    console.error('[LOG] CRITICAL: Unhandled exception in main handler.', error);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'An internal server error occurred.' }),
    };
  }
};

