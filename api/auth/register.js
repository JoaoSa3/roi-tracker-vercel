const bcrypt = require("bcryptjs");
const { createUser } = require("../../lib/db");
const { generateToken } = require("../../lib/auth");

const USER_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const PASS_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (!USER_RE.test(username)) return res.status(400).json({ error: "Username inválido. Use 3-30 chars (letters, numbers, _ . -)." });
  if (!PASS_RE.test(password)) return res.status(400).json({ error: "Senha fraca. Use 8+ chars, maiúscula, minúscula, dígito e símbolo." });
  
  const hashed = bcrypt.hashSync(password, 10);
  const user = await createUser(username, hashed);
  if (!user) return res.status(400).json({ error: "Nome de utilizador indisponível" });
  
  const token = generateToken(user);
  res.json({ user, token });
};
