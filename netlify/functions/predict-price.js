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
    const { ticker, type } = event.queryStringParameters;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    // --- Basic validation ---
    if (!apiKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "API key is not configured by the site owner." }),
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
    let marketCurrency = 'USD'; // Default to USD

    // --- Logic to build the correct API URL based on asset type ---
    const assetType = type.toLowerCase();
    if (assetType === 'stock') {
        url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${apiKey}`;
        dataKey = "Time Series (Daily)";
        priceKey = "4. close";
    } else if (assetType === 'crypto') {
        // For crypto, we query against a major currency like USD
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
        const response = await fetch(url);
        const data = await response.json();

        // --- Handle API errors or invalid symbols ---
        if (data["Error Message"] || !data[dataKey]) {
             return {
                statusCode: 404,
                body: JSON.stringify({ error: `Could not find data for "${ticker}". Please check the symbol and asset type.` }),
            };
        }

        const timeSeries = data[dataKey];
        const closingPrices = Object.values(timeSeries).map(day => parseFloat(day[priceKey]));

        const prediction = calculateSma(closingPrices, 20);

        if (prediction === null) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Not enough historical data to generate a prediction." }),
            };
        }
        
        const lastClose = closingPrices[0];

        // --- Send a successful response ---
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
        console.error("Prediction function error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "An unexpected error occurred." }),
        };
    }
};
