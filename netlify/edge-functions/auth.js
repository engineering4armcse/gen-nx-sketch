// Password gate in front of the whole site (pages and the /api/midas proxy). Runs only when APP_PASSWORD is set in
// Netlify > Site configuration > Environment variables; see auth.mjs.
import { gate } from "../../auth.mjs";

export default async (req, context) => (await gate(req, Netlify.env.get("APP_PASSWORD"), Netlify.env.get("APP_SECRET"))) || context.next();
export const config = { path: "/*" };
