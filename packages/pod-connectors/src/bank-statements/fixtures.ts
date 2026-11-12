// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** Synthetic exports only. No account numbers, personal data or network I/O. */
export const REVOLUT_HEADER =
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance";
export const REVOLUT_ROWS = [
  'CARD_PAYMENT,Current,2026-07-01 09:00:00,2026-07-01 10:00:00,"Synthetic café, ""Orbit""",-12.50,0.20,GBP,COMPLETED,987.30',
  "TRANSFER,Current,2026-07-02 09:00:00,2026-07-02 09:00:00,Synthetic credit,9007199254740993.01,0.00,EUR,COMPLETED,9007199254741093.01",
  "CARD_PAYMENT,Current,2026-07-03 09:00:00,,Pending,-1.00,0,GBP,PENDING,",
  "TRANSFER,Savings,2026-07-04 09:00:00,2026-07-04 09:00:00,Synthetic saving,10.00,0,GBP,COMPLETED,10.00",
] as const;
export const REVOLUT = `\uFEFF${REVOLUT_HEADER}\r\n${REVOLUT_ROWS.join("\r\n")}\r\n`;
export const HSBC =
  '01/07/2026,"Synthetic shop, main branch","-1,234.56"\r\n02/07/2026,Synthetic credit,2500.00\r\n';
export const MONZO =
  "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency\nsynthetic-1,01/07/2026,12:00:00,Card payment,Synthetic shop,,Shopping,-5.25,GBP,-6.00,EUR";
export const STARLING =
  'Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category,Notes\n01/07/2026,Synthetic shop,"=1+1, inert",CARD_PAYMENT,-2.50,97.50,Shopping,';
export const OFX =
  "OFXHEADER:100\r\n<OFX><CURDEF>GBP\r\n<STMTTRN><FITID>synthetic-1<DTPOSTED>20260120<TRNAMT>-12.50<NAME>Synthetic groceries</STMTTRN></OFX>";
/** Monzo's full export layout (18 columns): fictional merchants, addresses and IDs only. */
export const MONZO_FULL_HEADER =
  "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In";
export const MONZO_FULL_ROWS = [
  "tx_synthetic_full_1,02/07/2026,08:15:00,Card payment,Synthetic bakery,,Eating out,-3.40,GBP,-3.40,GBP,#synthetic,1 Example Street,,SYNTHETIC BAKERY EXAMPLETOWN,,-3.40,",
  "tx_synthetic_full_2,03/07/2026,09:00:00,Pot transfer,,,Savings,-20.00,GBP,-20.00,GBP,,,,Synthetic pot,,-20.00,",
  "tx_synthetic_full_3,04/08/2026,18:30:00,Faster payment,Synthetic employer,,Income,1500.00,GBP,1500.00,GBP,,,,SYNTHETIC SALARY,,,1500.00",
] as const;
export const MONZO_FULL = `${MONZO_FULL_HEADER}\n${MONZO_FULL_ROWS.join("\n")}\n`;
