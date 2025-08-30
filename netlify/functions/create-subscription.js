// Netlify Function: create-subscription.js
// This function finds an existing user or creates a new one for a free trial,
// then creates a subscription document for them in Firestore.

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

    // --- UPDATED LOGIC TO HANDLE NEW TRIAL USERS ---
    let userRecord;
    try {
        // Try to get an existing user by their email.
        userRecord = await auth.getUserByEmail(email);
        console.log(`SUCCESS: Found existing user with UID: ${userRecord.uid}`);
    } catch (error) {
        // Check if the error is because the user was not found.
        if (error.code === 'auth/user-not-found') {
            // *** FIX ***
            // If the user doesn't exist, we will ONLY create a new account if it's for a free trial.
            if (planId === 'trial') {
                console.log(`User not found for 'trial' plan. Creating new account for ${email}.`);
                try {
                    // Create a new user in Firebase Authentication.
                    // Note: This user is created without a password. They will need to use the 
                    // "Forgot Password" feature on your journal's login page to set their password for the first time.
                    userRecord = await auth.createUser({
                        email: email,
                        displayName: name || '',
                    });
                    console.log(`SUCCESS: Created new user for trial with UID: ${userRecord.uid}`);
                } catch (creationError) {
                    console.error(`ERROR: Failed to create new user during trial signup for email: ${email}`, creationError);
                    return { statusCode: 500, body: JSON.stringify({ error: `Could not create account: ${creationError.message}` }) };
                }
            } else {
                // For PAID plans, the original, correct behavior is maintained. The user MUST exist.
                console.error(`ERROR: User not found for paid plan (${planId}) with email: ${email}.`);
                return {
                    statusCode: 404,
                    body: JSON.stringify({ error: `Account for ${email} not found. Please sign up in the Trading Journal before buying a plan.` })
                };
            }
        } else {
            // For any other authentication errors (e.g., network issues), throw them to be handled by the main error catcher.
            console.error(`ERROR: An unexpected authentication error occurred for email: ${email}`, error);
            throw error;
        }
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
