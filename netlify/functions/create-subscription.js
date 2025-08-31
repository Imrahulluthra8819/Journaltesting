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
  const headers = {
    'Access-Control-Allow-Origin': '*', // In production, restrict this to your app's domain
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
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
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (parseError) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request format.' }) };
  }

  try {
    const { planId, email, name, phone, affiliateId } = body;

    if (!planId || !email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: planId and email.' }) };
    }

    let userRecord;
    let isNewUser = false;
    try {
        userRecord = await auth.getUserByEmail(email);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            // Only create a new user if they are signing up for a trial
            if (planId === 'trial') {
                userRecord = await auth.createUser({ email, displayName: name || '' });
                isNewUser = true;
            } else {
                // For paid plans, the user must already exist.
                return {
                    statusCode: 404, headers,
                    body: JSON.stringify({ error: `Account for ${email} not found. Please sign up in the Trading Journal before buying a plan.` })
                };
            }
        } else {
            // Re-throw other auth errors
            throw error;
        }
    }
    
    const uid = userRecord.uid;
    const subscriptionRef = db.collection('subscriptions').doc(uid);

    // *** FIX: ADDED LOGIC TO PREVENT REPEATED TRIALS ***
    // If the plan is 'trial' and it's NOT a new user, check for an existing subscription.
    if (planId === 'trial' && !isNewUser) {
        const doc = await subscriptionRef.get();
        // If a subscription document already exists, block the new trial.
        if (doc.exists) {
            return {
                statusCode: 403, // Forbidden
                headers,
                body: JSON.stringify({ error: 'A free trial has already been used for this account.' }),
            };
        }
    }

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

    const subscriptionData = {
      planId, userId: uid, userEmail: email, userName: name || null,
      userPhone: phone || null, affiliateId: affiliateId || 'direct',
      startDate: admin.firestore.Timestamp.fromDate(now),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Use { merge: true } to update existing subscriptions or create a new one
    await subscriptionRef.set(subscriptionData, { merge: true });

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

