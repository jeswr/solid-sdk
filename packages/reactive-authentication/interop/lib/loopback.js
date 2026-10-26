// Browsers may resolve `localhost` to ::1 only, while the local containers publish on 127.0.0.1 alone. This
// forwards [::1]:port to 127.0.0.1:port inside the harness process (loopback only), so `localhost` URLs —
// which CSS requires for plain-HTTP WebIDs — work in every engine without publishing Docker ports on IPv6.
// Only a genuinely unavailable IPv6 loopback is tolerated (then `localhost` can only mean 127.0.0.1); a port
// already taken on ::1 is an error, because browsers would reach that unrelated listener instead.
import { createConnection, createServer } from "node:net"
import { once } from "node:events"

const ipv6Unavailable = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"])

/** @returns {Promise<{close(): Promise<void>, ipv6: boolean}>} */
export async function forwardIpv6Loopback(ports) {
    const servers = []
    const sockets = new Set()
    const close = async () => {
        for (const socket of sockets) socket.destroy()
        await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))))
    }
    try {
        for (const port of ports) {
            const server = createServer(socket => {
                const upstream = createConnection({host: "127.0.0.1", port})
                for (const s of [socket, upstream]) {
                    sockets.add(s)
                    s.on("close", () => sockets.delete(s))
                    s.on("error", () => { socket.destroy(); upstream.destroy() })
                }
                socket.pipe(upstream).pipe(socket)
            })
            server.listen(port, "::1")
            try {
                await Promise.race([once(server, "listening"), once(server, "error").then(([error]) => { throw error })])
            } catch (error) {
                if (ipv6Unavailable.has(error.code)) return {close, ipv6: false}
                throw new Error(`cannot forward [::1]:${port} (${error.code ?? error.message}); something else listens there`)
            }
            servers.push(server)
        }
        return {close, ipv6: true}
    } catch (error) {
        await close()
        throw error
    }
}
