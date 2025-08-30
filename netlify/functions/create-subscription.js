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
    // If initialization fails, we stop everything and report the error
    exports.handler = async () => ({
        statusCode: 500,
        body: JSON.stringify({ error: "CRITICAL: Firebase initialization failed. Check the function logs on Netlify for details." })
    });
    // This return prevents the rest of the file from running if initialization fails
    return;
}

const db = admin.firestore();

exports.handler = async (event, context) => {
  // This log runs only when the function is actually called by your website
  console.log("--- [HANDLER] Function invoked with event body:", event.body);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { planId, uid, email, name } = JSON.parse(event.body);

    if (!planId || !uid) {
      console.error("--- [ERROR] Missing planId or uid in request.");
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing planId or uid.' }) };
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
        console.error(`--- [ERROR] Invalid planId received: ${planId}`);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
    }
    
    endDate.setDate(now.getDate() + durationDays);

    const subscriptionData = {
      planId, userId: uid, userEmail: email || null, userName: name || null,
      startDate: admin.firestore.Timestamp.fromDate(now),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('subscriptions').doc(uid).set(subscriptionData);
    console.log(`--- [SUCCESS] Subscription created for UID: ${uid}, Plan: ${planId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Subscription activated successfully.' }),
    };

  } catch (error) {
    console.error('--- [CRITICAL ERROR] Unhandled exception in handler ---', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Could not activate subscription.' }),
    };
  }
};

