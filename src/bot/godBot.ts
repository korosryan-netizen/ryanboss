
import { GodBot } from './bot/godBot';

const bot = new GodBot({
  appId: import.meta.env.NEXT_PUBLIC_DERIV_APP_ID,
  token: authorizedDerivToken,
  stake: 1,
  targetProfit: 2,
  stopLoss: 2,
  runs: 2,
  currency: 'USD',
}, {
  onStatus: console.log,
  onTrade: result => console.log(result),
  onProfit: console.log,
});

bot.start();
```
The exact place to call this from your UI depends on the bot page/component already present in the repository.
