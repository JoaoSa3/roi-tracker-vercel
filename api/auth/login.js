const bcrypt = require("bcryptjs");
const { getUserByUsername } = require("../../lib/db");
const { generateToken } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  
  const row = await getUserByUsername(username);
  if (!row) return res.status(400).json({ error: "Invalid credentials" });
  
  const ok = bcrypt.compareSync(password, row.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });
  
  const user = { id: row.id, username: row.username };
  const token = generateToken(user);
  res.json({ user, token });
};
