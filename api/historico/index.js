const { verifyToken } = require("../../lib/auth");
const { getHistorico, addHistoricoEntry, saveHistorico, deleteHistorico } = require("../../lib/db");

module.exports = async function handler(req, res) {
  const payload = verifyToken(req.headers["authorization"]);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  
  if (req.method === "GET") {
    const rows = await getHistorico(payload.id);
    res.json(rows);
  } else if (req.method === "POST") {
    const { dia, weekday, valor, roi, fechado } = req.body;
    const entries = await addHistoricoEntry(payload.id, { dia, weekday, valor, roi, fechado: fechado ? 1 : 0 });
    res.json({ ok: true });
  } else if (req.method === "DELETE") {
    await deleteHistorico(payload.id);
    res.json({ deleted: true });
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
};
