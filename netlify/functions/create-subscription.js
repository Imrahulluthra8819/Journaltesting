// This log will run the moment the file is loaded by Netlify
console.log("--- [START] create-subscription.js file is executing ---");

const admin = require('firebase-admin');
// This log confirms the 'firebase-admin' package was found and loaded
console.log("--- [OK] 'firebase-admin' package required successfully ---");

try {
    // This block tries to initialize the connection to your Firebase database
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    }
    // This log confirms the initialization was successful
    console.log("--- [OK] Firebase Admin SDK initialized successfully ---");
} catch (e) {
    // This will catch any errors during initialization (e.g., bad private key)
    console.error("--- [CRITICAL ERROR] Firebase admin initialization FAILED ---", e);
    exports.handler = async () => ({
        statusCode: 500,
        body: JSON.stringify({ error: "CRITICAL: Firebase initialization failed. Check the function logs on Netlify for details." })
    });
    return;
}

const db = admin.firestore();
const auth = admin.auth();

exports.handler = async (event, context) => {
  console.log("--- [HANDLER] Function invoked with event body:", event.body);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { planId, email, name, phone, affiliateId } = JSON.parse(event.body);

    if (!planId || !email) {
      console.error("--- [ERROR] Missing planId or email in request.");
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing planId or email.' }) };
    }

    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.log(`--- [INFO] User not found for ${email}. Creating new user. ---`);
            userRecord = await auth.createUser({
                email: email,
                displayName: name,
                // For security, it's better to send a password reset/setup email
                // than to create a user with a temporary password here.
            });
            console.log(`--- [SUCCESS] Created new user with UID: ${userRecord.uid}`);
        } else {
            // For any other auth error, re-throw it to be caught by the outer catch block
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
        console.error(`--- [ERROR] Invalid planId received: ${planId}`);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('subscriptions').doc(uid).set(subscriptionData);
    console.log(`--- [SUCCESS] Subscription created for UID: ${uid}, Plan: ${planId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Subscription activated successfully.', uid: uid }),
    };

  } catch (error) {
    console.error('--- [CRITICAL ERROR] Unhandled exception in handler ---', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Could not activate subscription.' }),
    };
  }
};

