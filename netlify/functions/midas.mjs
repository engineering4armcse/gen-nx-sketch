// Relay to the MIDAS API so the browser is not blocked by CORS: reads, plus writes of the rebar tables (REBB, REBC).
// The browser sends the MAPI-Key in the "mapi-key" header; it is forwarded and never stored or logged.
import { relay } from "../../proxy.mjs";

export default async req => relay(req);
export const config = { path: "/api/midas/*" };
