// AUTHORED-BY Codex GPT-6
import { createMoneyStore, MoneyIoError } from "../model";
export interface MoneyClient {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
}
export const moneyRoot = (client: MoneyClient) => new URL("money/", client.storageUrl).href;
export const storeOf = (client: MoneyClient) => createMoneyStore(client.fetch, moneyRoot(client));
/** Provision only absent containers; a 412 means another caller already created it. */
export async function provision(client: MoneyClient) {
  for (const path of ["", "accounts/", "transactions/", "statements/"]) {
    const response = await client.fetch(new URL(path, moneyRoot(client)), {
      method: "PUT",
      redirect: "error",
      headers: {
        "if-none-match": "*",
        "content-type": "text/turtle",
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
      body: "",
    });
    if (!response.ok && response.status !== 412) throw new MoneyIoError(response.status);
  }
}
