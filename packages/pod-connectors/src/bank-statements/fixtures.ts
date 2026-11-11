// AUTHORED-BY Codex GPT-6.1-Sol
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
