// A mocked wall clock (Date only): tests advance token expiry explicitly instead of sleeping or relying on a
// token being "expired" on arrival. Timers, networking and I/O stay real. Both the local mock servers and the
// library read the same mocked Date, so issued-at/expiry checks remain consistent.
import { mock } from "node:test"

/** Mocks `Date` for the duration of `body`, which receives `advance(ms)`. */
export async function withMockedDate(body) {
    mock.timers.enable({apis: ["Date"], now: Date.now()})
    try {
        return await body(ms => mock.timers.tick(ms))
    } finally {
        mock.timers.reset()
    }
}
