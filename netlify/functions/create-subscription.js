const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// This setup assumes you have set the FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, 
// and FIREBASE_PRIVATE_KEY environment variables in your Netlify settings.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { planId, uid, email, name } = JSON.parse(event.body);

    if (!planId || !uid) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing planId or uid.' }) };
    }

    const now = new Date();
    let endDate = new Date();
    let durationDays = 0;

    // Determine the subscription end date based on the planId
    switch (planId) {
      case 'trial':
        durationDays = 14;
        break;
      case 'monthly':
        durationDays = 30;
        break;
      case 'six-months':
        durationDays = 180;
        break;
      case 'yearly':
        durationDays = 365;
        break;
      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
    }
    
    endDate.setDate(now.getDate() + durationDays);

    // Create the subscription data object
    const subscriptionData = {
      planId: planId,
      userId: uid,
      userEmail: email || null,
      userName: name || null,
      startDate: admin.firestore.Timestamp.fromDate(now),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Save the subscription document in Firestore with the user's UID as the document ID
    await db.collection('subscriptions').doc(uid).set(subscriptionData);

    console.log(`Successfully created/updated subscription for UID: ${uid}, Plan: ${planId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Subscription activated successfully.',
        subscription: {
            planId: subscriptionData.planId,
            endDate: subscriptionData.endDate.toDate().toISOString()
        }
      }),
    };

  } catch (error) {
    console.error('Subscription Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Could not activate subscription.' }),
    };
  }
};

