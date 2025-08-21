const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Calculates a Simple Moving Average (SMA) from a list of prices.
 * @param {number[]} prices - An array of closing prices.
 * @param {number} window - The moving average window (e.g., 20 days).
 * @returns {number|null} The latest SMA value or null.
 */
function calculateSma(prices, window) {
    if (!prices || prices.length < window) {
        return null;
    }
    // Get the most recent 'window' number of prices
    const recentPrices = prices.slice(0, window);
    const sum = recentPrices.reduce((acc, price) => acc + price, 0);
    return sum / window;
}

/**
 * Netlify serverless function to fetch historical price data and return a simple prediction.
 */
exports.handler = async function (event) {
    const { ticker } = event.queryStringParameters;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    if (!apiKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "The site owner has not configured the ALPHA_VANTAGE_KEY. This feature is disabled." }),
        };
    }

    if (!ticker) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "A ticker symbol must be provided." }),
        };
    }

    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data["Error Message"] || !data["Time Series (Daily)"]) {
             return {
                statusCode: 404,
                body: JSON.stringify({ error: `Could not find historical data for "${ticker}". Please check the symbol.` }),
            };
        }

        const timeSeries = data["Time Series (Daily)"];
        // Extract closing prices and convert them to numbers
        const closingPrices = Object.values(timeSeries).map(day => parseFloat(day["4. close"]));

        // Calculate a 20-day SMA for a simple trend prediction
        const prediction = calculateSma(closingPrices, 20);

        if (prediction === null) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Not enough historical data to generate a prediction." }),
            };
        }
        
        const lastClose = closingPrices[0];

        return {
            statusCode: 200,
            body: JSON.stringify({
                ticker: ticker,
                prediction: prediction.toFixed(2),
                lastClose: lastClose.toFixed(2),
                model: "20-Day Simple Moving Average (SMA) Trend",
                disclaimer: "This is a simple trend indicator based on historical data, not financial advice. It represents the average price of the last 20 days."
            }),
        };

    } catch (error) {
        console.error("Prediction function error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "An unexpected error occurred while fetching the prediction." }),
        };
    }
};