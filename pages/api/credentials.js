import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const userId = session.user.id;
  const key = `user:${userId}:credentials`;
  
  if (req.method === "GET") {
    try {
      const credentials = await kv.get(key);
      return res.status(200).json({ credentials: credentials || null });
    } catch (error) {
      console.error("KV GET error:", error);
      return res.status(500).json({ error: "Failed to fetch credentials" });
    }
  }
  
  if (req.method === "POST") {
    try {
      const { league_id, team_id, espn_s2, swid } = req.body;
      
      const credentials = {
        league_id,
        team_id,
        espn_s2,
        swid,
        updated_at: new Date().toISOString(),
      };
      
      await kv.set(key, credentials);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("KV SET error:", error);
      return res.status(500).json({ error: "Failed to save credentials" });
    }
  }
  
  if (req.method === "DELETE") {
    try {
      await kv.del(key);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("KV DELETE error:", error);
      return res.status(500).json({ error: "Failed to delete credentials" });
    }
  }
  
  return res.status(405).json({ error: "Method not allowed" });
}
