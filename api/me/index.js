const { verifyToken } = require("../../lib/auth");
const { getUserById } = require("../../lib/db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  
  const payload = verifyToken(req.headers["authorization"]);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  
  const row = await getUserById(payload.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  
  res.json({ id: row.id, username: row.username, createdAt: row.createdAt });
};
