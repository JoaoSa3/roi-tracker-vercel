const { verifyToken } = require("../../lib/auth");
const { getConfig, saveConfig } = require("../../lib/db");

module.exports = async function handler(req, res) {
  const payload = verifyToken(req.headers["authorization"]);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  
  if (req.method === "GET") {
    const config = await getConfig(payload.id);
    res.json(config || null);
  } else if (req.method === "POST") {
    const { bancaInicial, meta, roi } = req.body;
    const saved = await saveConfig(payload.id, { bancaInicial, meta, roi });
    res.json(saved);
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
};
