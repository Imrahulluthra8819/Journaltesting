// Netlify Function: create-subscription.js
// This function finds an existing user and creates a subscription document for them in Firestore.

const admin = require('firebase-admin');

// This block initializes the connection to your Firebase database.
// It uses the environment variables you set up in your Netlify project.
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // The private key is formatted correctly for the server environment.
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    }
} catch (e) {
    console.error("CRITICAL ERROR: Firebase admin initialization FAILED.", e);
    // If initialization fails, the function will stop and log the error.
}

const db = admin.firestore();
const auth = admin.auth();

// This is the main function that runs when your payment page calls it.
exports.handler = async (event) => {
  console.log("Function invoked. Body:", event.body);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { planId, email, name, phone, affiliateId } = JSON.parse(event.body);

    if (!planId || !email) {
      console.error("ERROR: Missing planId or email in request.");
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: planId and email.' }) };
    }

    // --- NEW, MORE RELIABLE LOGIC ---
    // The function will now only find existing users. It will NOT create new ones.
    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`SUCCESS: Found existing user with UID: ${userRecord.uid}`);
    } catch (error) {
        // If the user does not exist, send a clear error message back to the payment page.
        if (error.code === 'auth/user-not-found') {
            console.error(`ERROR: User not found for email: ${email}. The user must sign up first.`);
            return {
                statusCode: 404, // 404 Not Found
                body: JSON.stringify({ error: `Account for ${email} not found. Please sign up for a free account in the Trading Journal tool before getting a subscription.` })
            };
        }
        // For any other authentication errors, throw them to be handled by the main error catcher.
        throw error;
    }

    const uid = userRecord.uid;
    const now = new Date();
    let endDate = new Date();
    let durationDays = 0;

    // Calculate the subscription end date based on the planId received.
    switch (planId) {
      case 'trial': durationDays = 14; break;
      case 'monthly': durationDays = 30; break;
      case 'six-months': durationDays = 180; break;
      case 'yearly': durationDays = 365; break;
      default:
        console.error(`ERROR: Invalid planId received: ${planId}`);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid planId provided.' }) };
    }
    
    endDate.setDate(now.getDate() + durationDays);

    // Prepare the subscription data to be saved in Firestore.
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

    // Create or update the subscription document in the 'subscriptions' collection.
    await db.collection('subscriptions').doc(uid).set(subscriptionData, { merge: true });
    console.log(`SUCCESS: Subscription created/updated for UID: ${uid}, Plan: ${planId}`);

    // Send a success response back to the payment page.
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Subscription activated successfully.' }),
    };

  } catch (error) {
    // This is the final safety net. It catches any unexpected errors.
    console.error('CRITICAL ERROR: Unhandled exception in handler.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An internal server error occurred. Could not activate subscription.' }),
    };
  }
};

