const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// --- TECHNICAL ANALYSIS CALCULATION HELPERS ---

// Calculates Simple Moving Average (SMA)
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
}

// Calculates Exponential Moving Average (EMA)
function calculateEMA(prices, period) {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emas = [prices[prices.length - 1]]; // Start with the oldest price
    for (let i = prices.length - 2; i >= 0; i--) {
        emas.push(prices[i] * k + emas[emas.length - 1] * (1 - k));
    }
    return emas.reverse(); // Return with newest first
}

// Calculates Relative Strength Index (RSI)
function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return null;
    let gains = 0;
    let losses = 0;
    // Calculate initial average gains and losses
    for (let i = prices.length - period - 1; i < prices.length - 1; i++) {
        const diff = prices[i] - prices[i + 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smooth the averages
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

// Calculates Bollinger Bands
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

// Calculates MACD
function calculateMACD(prices) {
    if (prices.length < 26) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine = ema12[0] - ema26[0];
    const signalLine = calculateEMA(ema12.map((val, i) => val - ema26[i]), 9)[0];
    const histogram = macdLine - signalLine;
    let signal = 'Neutral';
    if (macdLine > signalLine && histogram > 0) signal = 'Bullish Momentum';
    if (macdLine < signalLine && histogram < 0) signal = 'Bearish Momentum';
    return { macd: macdLine.toFixed(2), signal: signalLine.toFixed(2), histogram: histogram.toFixed(2), analysis: signal };
}

exports.handler = async function (event) {
    const { ticker, type } = event.queryStringParameters;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    if (!apiKey || !ticker || !type) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing required parameters." }) };
    }
    
    const assetType = type.toLowerCase();
    
    try {
        // --- STEP 1: FETCH TECHNICAL DATA (FOR ALL ASSET TYPES) ---
        let techUrl, dataKey, priceKey, marketCurrency = 'USD';

        if (assetType === 'stock') {
            techUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${apiKey}`;
            dataKey = "Time Series (Daily)"; priceKey = "4. close";
        } else if (assetType === 'crypto') {
            techUrl = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${ticker}&market=USD&apikey=${apiKey}`;
            dataKey = "Time Series (Digital Currency Daily)"; priceKey = "4a. close (USD)";
        } else if (assetType === 'forex') {
            const from_symbol = ticker.substring(0, 3); const to_symbol = ticker.substring(3, 6);
            techUrl = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from_symbol}&to_symbol=${to_symbol}&outputsize=compact&apikey=${apiKey}`;
            dataKey = "Time Series FX (Daily)"; priceKey = "4. close"; marketCurrency = to_symbol.toUpperCase();
        } else {
             return { statusCode: 400, body: JSON.stringify({ error: "Invalid asset type." }) };
        }

        const techResponse = await fetch(techUrl);
        const techData = await techResponse.json();

        if (techData.Note || techData["Error Message"] || !techData[dataKey]) {
            return { statusCode: 400, body: JSON.stringify({ error: `Could not fetch technical data for ${ticker}. (Message: ${techData.Note || techData["Error Message"] || 'Invalid symbol'})` }) };
        }

        // --- STEP 2: CALCULATE TECHNICAL INDICATORS ---
        const timeSeries = techData[dataKey];
        const closingPrices = Object.values(timeSeries).map(day => parseFloat(day[priceKey])).reverse(); // Reverse to have oldest first for calculations
        const newestPricesFirst = [...closingPrices].reverse(); // Keep a copy with newest first

        const technicalAnalysis = {
            rsi: calculateRSI(closingPrices),
            macd: calculateMACD(closingPrices),
            bollingerBands: calculateBollingerBands(newestPricesFirst),
            sma20: calculateSMA(newestPricesFirst, 20)?.toFixed(2),
            sma50: calculateSMA(newestPricesFirst, 50)?.toFixed(2),
        };

        // --- STEP 3: FETCH FUNDAMENTAL DATA (ONLY FOR STOCKS) ---
        let fundamentalAnalysis = null;
        if (assetType === 'stock') {
            const fundamentalUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;
            const fundamentalResponse = await fetch(fundamentalUrl);
            const fundamentalData = await fundamentalResponse.json();
            if (fundamentalData && !fundamentalData.Note && !fundamentalData["Error Message"] && fundamentalData.Symbol) {
                 fundamentalAnalysis = {
                    marketCap: fundamentalData.MarketCapitalization,
                    peRatio: fundamentalData.PERatio,
                    eps: fundamentalData.EPS,
                    analystTargetPrice: fundamentalData.AnalystTargetPrice,
                    yearHigh: fundamentalData["52WeekHigh"],
                    yearLow: fundamentalData["52WeekLow"],
                    description: fundamentalData.Description
                };
            }
        }

        // --- STEP 4: COMPILE AND RETURN THE FINAL REPORT ---
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
