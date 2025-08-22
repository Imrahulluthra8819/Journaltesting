const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// --- TECHNICAL ANALYSIS CALCULATION HELPERS (Unchanged) ---

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


// --- MAIN HANDLER ---
exports.handler = async function (event) {
    const { ticker, type } = event.queryStringParameters;

    if (!ticker || !type) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing ticker or type." }) };
    }
    
    // --- YAHOO FINANCE TICKER FORMATTING ---
    let yahooTicker = ticker.toUpperCase();
    const assetType = type.toLowerCase();

    if (assetType === 'stock') {
        // Append suffixes for Indian stocks if they don't have them
        if (!yahooTicker.includes('.')) {
            if (yahooTicker === 'NIFTY_50' || yahooTicker === 'NIFTY 50') yahooTicker = '^NSEI';
            else if (yahooTicker === 'NIFTY_BANK') yahooTicker = '^NSEBANK';
            else if (yahooTicker === 'SENSEX') yahooTicker = '^BSESN';
            else {
                // Assume NSE for Indian stocks if no exchange is specified
                yahooTicker = `${yahooTicker}.NS`; 
            }
        }
    } else if (assetType === 'crypto') {
        yahooTicker = `${yahooTicker}-USD`;
    } else if (assetType === 'forex') {
        yahooTicker = `${yahooTicker}=X`;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?region=US&lang=en-US&includePrePost=false&interval=1d&useYfid=true&range=3mo`;

    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await response.json();

        if (!response.ok || !data.chart?.result?.[0]?.timestamp) {
            return { statusCode: 404, body: JSON.stringify({ error: `Could not find data for "${ticker}". Please check the symbol and asset type.` }) };
        }

        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];
        const closingPrices = quotes.close.filter(p => p !== null).reverse(); // Oldest first
        const newestPricesFirst = [...closingPrices].reverse();
        const dates = timestamps.map(ts => new Date(ts * 1000).toLocaleDateString('en-GB', {day:'2-digit', month:'short'}));
        
        const technicalAnalysis = {
            rsi: calculateRSI(closingPrices),
            macd: calculateMACD(closingPrices, dates),
            bollingerBands: calculateBollingerBands(newestPricesFirst),
            ema5: calculateEMA(newestPricesFirst, 5)[0]?.toFixed(2),
            ema9: calculateEMA(newestPricesFirst, 9)[0]?.toFixed(2),
            sma50: calculateSMA(newestPricesFirst, 50)?.toFixed(2),
        };

        // For Yahoo Finance, we don't get a separate fundamental overview in this call,
        // so we'll just return the technicals.
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                ticker: result.meta.symbol,
                lastClose: newestPricesFirst[0].toFixed(2),
                currency: result.meta.currency,
                technicalAnalysis,
                fundamentalAnalysis: null // No fundamental data from this endpoint
            }),
        };

    } catch (error) {
        console.error("Function error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "An unexpected server error occurred." }) };
    }
};
