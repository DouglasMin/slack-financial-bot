import * as market from '../services/market.js';
import * as store from '../services/store.js';
import { formatAlertMessage, postMessage } from '../utils/slack.js';
import { buildPriceRequest } from '../utils/parser.js';

export async function handler(event) {
  try {
    // 1. Scan AlertTable active-index for active="true"
    const activeAlerts = await store.scanByIndex(
      process.env.ALERT_TABLE,
      'active-index',
      'active = :active',
      { ':active': 'true' },
    );

    if (!activeAlerts || activeAlerts.length === 0) {
      return { statusCode: 200, body: 'No active alerts' };
    }

    // 2. Group by symbol, batch fetch prices
    const symbolSet = new Map();
    for (const alert of activeAlerts) {
      if (!symbolSet.has(alert.symbol)) {
        symbolSet.set(alert.symbol, buildPriceRequest(alert.symbol));
      }
    }

    const prices = await market.getBatchPrices([...symbolSet.values()]);

    // Build a lookup map: original symbol -> current price
    // Normalize FX symbols so both "USD/KRW" and "USDKRW" match
    const priceMap = new Map();
    for (const p of prices) {
      const price = p.price ?? p.rate;
      if (p.symbol) {
        priceMap.set(p.symbol, price);
        // Also store without slash for FX lookups
        priceMap.set(p.symbol.replace('/', ''), price);
      }
      if (p.from && p.to) {
        priceMap.set(`${p.from}${p.to}`, p.rate);
        priceMap.set(`${p.from}/${p.to}`, p.rate);
      }
    }

    // 3. Check each alert
    for (const alert of activeAlerts) {
      try {
        const currentPrice = priceMap.get(alert.symbol);
        if (currentPrice == null) continue;

        const triggered =
          (alert.direction === 'above' && currentPrice >= alert.targetPrice) ||
          (alert.direction === 'below' && currentPrice <= alert.targetPrice);

        if (triggered) {
          // 4a. Send DM to user
          const blocks = formatAlertMessage({
            symbol: alert.symbol,
            targetPrice: alert.targetPrice,
            currentPrice,
            direction: alert.direction,
          });
          await postMessage(alert.userId, blocks);

          // 4b. Deactivate alert
          await store.updateItem(
            process.env.ALERT_TABLE,
            { userId: alert.userId, alertId: alert.alertId },
            'SET active = :inactive',
            { ':inactive': 'false' },
          );
        }
      } catch (alertError) {
        // Individual alert failure should not affect others
        console.error(`Alert ${alert.alertId} failed:`, alertError);
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('AlertPoller error:', error);
    return { statusCode: 500, body: error.message };
  }
}

