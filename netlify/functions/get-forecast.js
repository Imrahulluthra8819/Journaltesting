const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper to call the Gemini API
async function callGemini(prompt, apiKey) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
        },
    };
    try {
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error("Gemini API Error:", errorBody);
            return null;
        }
        const result = await apiResponse.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.error("Gemini Function Error:", error);
        return null;
    }
}

// Main serverless function handler
exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { symbol, timeframe, steps, trades } = JSON.parse(event.body);
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
        console.error("GEMINI_API_KEY environment variable not set.");
        return { statusCode: 500, body: JSON.stringify({ error: "AI service is not configured." }) };
    }

    // IMPORTANT: This prompt asks the AI to generate a *simulated* forecast.
    // This is for journaling and educational purposes, not real financial advice.
    const prompt = `
        You are a sophisticated financial analyst AI. Your task is to generate a plausible, simulated price forecast for a financial asset based on the provided context.

        **IMPORTANT RULES:**
        1.  The data you generate is a simulation for a trading journal. It is NOT real financial advice.
        2.  You MUST return the data in the specified JSON format and nothing else.
        3.  Generate 50 data points for the "historical" part of the chart and exactly the number of forecast "steps" requested by the user.
        4.  The "chartData" dates should be recent, ending today, and formatted as "YYYY-MM-DD".
        5.  The "metrics" values should be mathematically consistent with the generated chart data.
        6.  The "concentrationPrice" should be a price level where activity appears most frequent in your generated data.
        7.  The "trend" MUST be either "Bullish" or "Bearish".

        **Context:**
        -   **Asset Symbol:** ${symbol}
        -   **Forecast Timeframe:** ${timeframe}
        -   **Forecast Steps:** ${steps}
        -   **User's Recent Trading Bias (for context only):** ${JSON.stringify(trades)}

        **Required JSON Output Format:**
        {
          "chartData": [
            {"date": "YYYY-MM-DD", "price": 100.00},
            ...
          ],
          "metrics": {
            "trend": "Bullish",
            "avgPercentageChange": 1.23,
            "volatility": 2.34,
            "cumulativeReturn": 5.67,
            "concentrationPrice": 105.50,
            "maxDrawdown": -3.45
          }
        }
    `;

    try {
        const aiResponse = await callGemini(prompt, geminiApiKey);
        if (!aiResponse) {
            throw new Error("The AI model did not return a valid response.");
        }

        const parsedData = JSON.parse(aiResponse);
        return {
            statusCode: 200,
            body: JSON.stringify(parsedData),
        };

    } catch (error) {
        console.error("Error in get-forecast function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to parse AI forecast data. Please try again." }),
        };
    }
};
