const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// --- TECHNICAL ANALYSIS CALCULATION HELPERS ---

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices, period) {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emas = [prices[prices.length - 1]];
    for (let i = prices.length - 2; i >= 0; i--) {
        emas.push(prices[i] * k + emas[emas.length - 1] * (1 - k));
    }
    return emas.reverse();
}

function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return null;
    let gains = 0, losses = 0;
    for (let i = prices.length - period - 1; i < prices.length - 1; i++) {
        const diff = prices[i] - prices[i + 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = prices.length - period - 2; i >= 0; i--) {
        const diff = prices[i] - prices[i + 1];
        if (diff > 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    if (avgLoss === 0) return { value: 100, signal: 'Extremely Overbought' };
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    let signal = 'Neutral';
    if (rsi > 70) signal = 'Overbought';
    if (rsi < 30) signal = 'Oversold';
    return { value: rsi.toFixed(2), signal };
}

function calculateBollingerBands(prices, period = 20) {
    if (prices.length < period) return null;
    const middle = calculateSMA(prices, period);
    const stdDev = Math.sqrt(prices.slice(0, period).map(p => Math.pow(p - middle, 2)).reduce((a, b) => a + b, 0) / period);
    const upper = middle + (stdDev * 2);
    const lower = middle - (stdDev * 2);
    let signal = 'In Bands';
    if (prices[0] > upper) signal = 'Above Bands (Volatile Up)';
    if (prices[0] < lower) signal = 'Below Bands (Volatile Down)';
    return { upper: upper.toFixed(2), middle: middle.toFixed(2), lower: lower.toFixed(2), signal };
}

// ** MODIFIED to return historical data for the chart **
function calculateMACD(prices, dates, historyLength = 30) {
    if (prices.length < 26) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine = ema12.map((val, i) => val - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    
    const histogram = macdLine.map((val, i) => val - signalLine[i]);
    
    let signal = 'Neutral';
    if (macdLine[0] > signalLine[0] && histogram[0] > 0) signal = 'Bullish Momentum';
    if (macdLine[0] < signalLine[0] && histogram[0] < 0) signal = 'Bearish Momentum';

    return {
        macd: macdLine[0].toFixed(2),
        signal: signalLine[0].toFixed(2),
        histogram: histogram[0].toFixed(2),
        analysis: signal,
        history: {
            labels: dates.slice(0, historyLength).reverse(),
            data: histogram.slice(0, historyLength).reverse()
        }
    };
}

exports.handler = async function (event) {
    const { ticker, type } = event.queryStringParameters;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    if (!apiKey || !ticker || !type) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing required parameters." }) };
    }
    
    const assetType = type.toLowerCase();
    
    try {
        let techUrl, dataKey, priceKey, marketCurrency = 'USD';

        if (assetType === 'stock') {
            techUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=compact&symbol=${ticker}&apikey=${apiKey}`;
            dataKey = "Time Series (Daily)"; priceKey = "4. close";
        } else if (assetType === 'crypto') {
            techUrl = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${ticker}&market=USD&apikey=${apiKey}`;
            dataKey = "Time Series (Digital Currency Daily)"; priceKey = "4a. close (USD)";
        } else if (assetType === 'forex') {
            const from_symbol = ticker.substring(0, 3); const to_symbol = ticker.substring(3, 6);
            techUrl = `https://www.alphavantage.co/query?function=FX_DAILY&outputsize=compact&from_symbol=${from_symbol}&to_symbol=${to_symbol}&apikey=${apiKey}`;
            dataKey = "Time Series FX (Daily)"; priceKey = "4. close"; marketCurrency = to_symbol.toUpperCase();
        } else {
             return { statusCode: 400, body: JSON.stringify({ error: "Invalid asset type." }) };
        }

        const techResponse = await fetch(techUrl);
        const techData = await techResponse.json();

        if (techData.Note || techData["Error Message"] || !techData[dataKey]) {
            return { statusCode: 400, body: JSON.stringify({ error: `Could not fetch technical data for ${ticker}. (Message: ${techData.Note || techData["Error Message"] || 'Invalid symbol'})` }) };
        }

        const timeSeries = techData[dataKey];
        const dates = Object.keys(timeSeries); // Get dates for chart labels
        const closingPrices = Object.values(timeSeries).map(day => parseFloat(day[priceKey])).reverse();
        const newestPricesFirst = [...closingPrices].reverse();

        // ** UPDATED technical analysis object **
        const technicalAnalysis = {
            rsi: calculateRSI(closingPrices),
            macd: calculateMACD(closingPrices, dates), // Pass dates to MACD
            bollingerBands: calculateBollingerBands(newestPricesFirst),
            ema5: calculateEMA(newestPricesFirst, 5)[0]?.toFixed(2),
            ema9: calculateEMA(newestPricesFirst, 9)[0]?.toFixed(2),
            sma50: calculateSMA(newestPricesFirst, 50)?.toFixed(2),
        };

        let fundamentalAnalysis = null;
        if (assetType === 'stock') {
            const fundamentalUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;
            const fundamentalResponse = await fetch(fundamentalUrl);
            const fundamentalData = await fundamentalResponse.json();
            if (fundamentalData && !fundamentalData.Note && !fundamentalData["Error Message"] && fundamentalData.Symbol) {
                 fundamentalAnalysis = {
                    marketCap: fundamentalData.MarketCapitalization, peRatio: fundamentalData.PERatio, eps: fundamentalData.EPS,
                    analystTargetPrice: fundamentalData.AnalystTargetPrice, yearHigh: fundamentalData["52WeekHigh"], yearLow: fundamentalData["52WeekLow"],
                    description: fundamentalData.Description
                };
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                ticker: ticker.toUpperCase(),
                lastClose: newestPricesFirst[0].toFixed(2),
                currency: marketCurrency,
                technicalAnalysis,
                fundamentalAnalysis
            }),
        };

    } catch (error) {
        console.error("Function error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "An unexpected server error occurred." }) };
    }
};
