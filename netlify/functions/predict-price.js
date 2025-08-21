const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper function to calculate the Simple Moving Average
function calculateSma(prices, window) {
    if (!prices || prices.length < window) {
        return null;
    }
    const recentPrices = prices.slice(0, window);
    const sum = recentPrices.reduce((acc, price) => acc + price, 0);
    return sum / window;
}

exports.handler = async function (event) {
    // Log the incoming request to help with debugging in Netlify
    console.log("Received event:", event);

    const { ticker, type } = event.queryStringParameters;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    if (!apiKey) {
        console.error("ALPHA_VANTAGE_KEY is not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "API key is not configured. The site owner needs to set it in Netlify." }),
        };
    }
    if (!ticker || !type) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "A ticker and asset type must be provided." }),
        };
    }

    let url;
    let dataKey;
    let priceKey;
    let marketCurrency = 'USD';

    const assetType = type.toLowerCase();
    console.log(`Building URL for asset type: ${assetType} and ticker: ${ticker}`);

    if (assetType === 'stock') {
        url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${apiKey}`;
        dataKey = "Time Series (Daily)";
        priceKey = "4. close";
    } else if (assetType === 'crypto') {
        url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${ticker}&market=USD&apikey=${apiKey}`;
        dataKey = "Time Series (Digital Currency Daily)";
        priceKey = "4a. close (USD)";
    } else if (assetType === 'forex') {
        if (ticker.length !== 6) {
            return { statusCode: 400, body: JSON.stringify({ error: "Forex ticker must be a 6-letter pair (e.g., EURUSD)." }) };
        }
        const from_symbol = ticker.substring(0, 3);
        const to_symbol = ticker.substring(3, 6);
        url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from_symbol}&to_symbol=${to_symbol}&outputsize=compact&apikey=${apiKey}`;
        dataKey = "Time Series FX (Daily)";
        priceKey = "4. close";
        marketCurrency = to_symbol.toUpperCase();
    } else {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid asset type specified." }) };
    }

    try {
        console.log("Calling Alpha Vantage URL:", url);
        const response = await fetch(url);
        const data = await response.json();

        // Log the raw response from the API for debugging
        console.log("Alpha Vantage API Response:", JSON.stringify(data, null, 2));

        // CRITICAL CHECK: Alpha Vantage often sends a "Note" for rate limiting
        if (data.Note) {
            console.error("API Limit Reached:", data.Note);
            return { statusCode: 429, body: JSON.stringify({ error: `API limit likely reached. Please try again later. (API message: "${data.Note}")` }) };
        }

        if (data["Error Message"] || !data[dataKey]) {
             return {
                statusCode: 404,
                body: JSON.stringify({ error: `Could not find data for "${ticker}". Please check the symbol and asset type. The API returned: ${data["Error Message"] || 'No data found'}` }),
            };
        }

        const timeSeries = data[dataKey];
        const closingPrices = Object.values(timeSeries).map(day => parseFloat(day[priceKey]));
        const prediction = calculateSma(closingPrices, 20);

        if (prediction === null) {
            return { statusCode: 500, body: JSON.stringify({ error: "Not enough historical data to generate a prediction (need at least 20 days)." }) };
        }
        
        const lastClose = closingPrices[0];

        return {
            statusCode: 200,
            body: JSON.stringify({
                ticker: ticker.toUpperCase(),
                prediction: prediction.toFixed(2),
                lastClose: lastClose.toFixed(2),
                currency: marketCurrency,
                model: "20-Day Simple Moving Average (SMA) Trend",
                disclaimer: "This is a simple trend indicator based on historical data, not financial advice."
            }),
        };

    } catch (error) {
        console.error("Unhandled error in prediction function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "An unexpected server error occurred." }),
        };
    }
};
